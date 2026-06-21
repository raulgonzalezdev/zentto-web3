import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { fromBase, isPositive, toBase } from '../common/money.util';
import { PaymentEntity } from '../database/entities/payment.entity';
import { RechargeRequestEntity } from '../database/entities/recharge-request.entity';
import { UserEntity } from '../database/entities/user.entity';
import { FEE_ACCOUNT, FeeService } from '../fees/fee.service';
import { LedgerService } from '../ledger/ledger.service';

export interface CreateRechargeInput {
  amount: string;
  rateVes: string;
}

const ASSET = 'USDC';
const METHOD = 'pago_movil';

/**
 * Panel formal de operadores (modelo tipo AirTM). El usuario crea una solicitud de
 * recarga: paga en bolívares (pago móvil) a un operador verificado y este entrega el
 * cripto acreditándolo en el ledger. Flujo: pending→claimed→paid→completed.
 *
 * La acreditación final es atómica y de doble entrada: el custody respalda el monto,
 * el usuario recibe el neto y la plataforma cobra su comisión a tesorería.
 */
@Injectable()
export class RechargeService {
  constructor(
    @InjectRepository(RechargeRequestEntity)
    private readonly requests: Repository<RechargeRequestEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly ledger: LedgerService,
    private readonly fees: FeeService,
    private readonly auth: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  /** Bs a pagar = amount(cripto) * rateVes, en aritmética exacta (escala 2). */
  private fiatFor(amount: string, rateVes: string): string {
    // toBase lleva ambos a base 1e18; el producto queda en base 1e36 → reescalar.
    const productBase = (toBase(amount) * toBase(rateVes)) / 10n ** 18n;
    const fiat = fromBase(productBase);
    // Redondear a 2 decimales (bolívares).
    const [intPart, fracRaw = ''] = fiat.split('.');
    const frac = (fracRaw + '00').slice(0, 2);
    return `${intPart}.${frac}`;
  }

  private async emailMap(userIds: string[]): Promise<Map<string, string>> {
    const ids = userIds.filter((id): id is string => !!id);
    if (ids.length === 0) return new Map();
    const rows = await this.users.find({ where: { id: In(ids) }, select: ['id', 'email'] });
    return new Map(rows.map((u) => [u.id, u.email]));
  }

  // ─────────────────────────────── Usuario ───────────────────────────────

  async createRequest(userId: string, input: CreateRechargeInput): Promise<RechargeRequestEntity> {
    const { amount, rateVes } = input;
    if (!isPositive(amount)) throw new BadRequestException('amount debe ser > 0');
    if (!isPositive(rateVes)) throw new BadRequestException('rateVes debe ser > 0');

    const request = this.requests.create({
      id: randomUUID(),
      userId,
      operatorUserId: null,
      method: METHOD,
      asset: ASSET,
      amount,
      rateVes,
      fiatAmount: this.fiatFor(amount, rateVes),
      status: 'pending',
      operatorPaymentInfo: null,
      evidence: null,
      feeAmount: '0',
      claimedAt: null,
    });
    return this.requests.save(request);
  }

  async myRequests(userId: string): Promise<RechargeRequestEntity[]> {
    return this.requests.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /** El usuario cancela su solicitud mientras sigue pendiente o reclamada. */
  async cancel(userId: string, id: string): Promise<RechargeRequestEntity> {
    const req = await this.requests.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    if (req.userId !== userId) throw new ForbiddenException('No es tu solicitud');
    if (req.status !== 'pending' && req.status !== 'claimed') {
      throw new BadRequestException('La solicitud ya no se puede cancelar');
    }
    req.status = 'cancelled';
    return this.requests.save(req);
  }

  /** El usuario sube el comprobante del pago fiat (claimed→paid). */
  async submitEvidence(
    userId: string,
    id: string,
    attachment: string,
  ): Promise<RechargeRequestEntity> {
    const req = await this.requests.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    if (req.userId !== userId) throw new ForbiddenException('No es tu solicitud');
    if (req.status !== 'claimed') {
      throw new BadRequestException('Solo puedes subir evidencia tras reclamar el operador');
    }
    req.evidence = this.validateAttachment(attachment);
    req.status = 'paid';
    return this.requests.save(req);
  }

  // ─────────────────────────────── Operador ───────────────────────────────

  /** Cola abierta: solicitudes pendientes (con email del usuario). */
  async listOpen() {
    const rows = await this.requests.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const emails = await this.emailMap(rows.map((r) => r.userId));
    return rows.map((r) => ({ ...r, userEmail: emails.get(r.userId) ?? null }));
  }

  /** El operador reclama una solicitud pendiente y comparte sus datos de pago. */
  async claim(
    operatorId: string,
    id: string,
    operatorPaymentInfo: string,
  ): Promise<RechargeRequestEntity> {
    const info = (operatorPaymentInfo ?? '').trim();
    if (!info) throw new BadRequestException('Debes indicar tus datos de pago');
    const req = await this.requests.findOne({ where: { id } });
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    if (req.status !== 'pending')
      throw new BadRequestException('La solicitud ya no está disponible');
    if (req.userId === operatorId) {
      throw new BadRequestException('No puedes atender tu propia solicitud');
    }
    req.operatorUserId = operatorId;
    req.operatorPaymentInfo = info.slice(0, 1000);
    req.status = 'claimed';
    req.claimedAt = new Date();
    return this.requests.save(req);
  }

  /**
   * El operador asignado confirma y acredita el cripto al usuario. Exige 2FA.
   * Doble entrada: debita custody por el bruto, acredita al usuario el neto y a
   * tesorería la comisión. Registra un PaymentEntity y marca la solicitud completada.
   */
  async confirm(operatorId: string, id: string, totpCode?: string): Promise<RechargeRequestEntity> {
    // Acreditar mueve fondos → segundo factor obligatorio del operador.
    await this.auth.assertStepUp(operatorId, totpCode);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RechargeRequestEntity);
      const req = await repo.findOne({ where: { id } });
      if (!req) throw new NotFoundException('Solicitud no encontrada');
      if (req.operatorUserId !== operatorId) {
        throw new ForbiddenException('Solo el operador asignado puede confirmar');
      }
      if (req.status !== 'paid' && req.status !== 'claimed') {
        throw new BadRequestException('La solicitud no admite confirmación en su estado actual');
      }

      const quote = this.fees.quoteDeposit(req.amount);
      const custodyAcc = await this.ledger.getOrCreateAccount(
        'system',
        'custody',
        req.asset,
        manager,
      );
      const userAcc = await this.ledger.getOrCreateAccount('user', req.userId, req.asset, manager);
      const feeAcc = await this.ledger.getOrCreateAccount(
        'system',
        FEE_ACCOUNT,
        req.asset,
        manager,
      );

      const payment = manager.getRepository(PaymentEntity).create({
        id: randomUUID(),
        idempotencyKey: `recharge:${req.id}`,
        userId: req.userId,
        type: 'recharge',
        asset: req.asset,
        amount: req.amount,
        status: 'completed',
        fromAccountId: custodyAcc.id,
        toAccountId: userAcc.id,
        counterparty: 'recharge_operator',
        metadata: {
          rechargeId: req.id,
          operatorId,
          grossAmount: req.amount,
          fee: quote.platformFee,
          method: METHOD,
        },
      });
      await manager.getRepository(PaymentEntity).save(payment);

      const entries = [
        {
          accountId: custodyAcc.id,
          direction: 'debit' as const,
          amount: req.amount,
          asset: req.asset,
        },
        {
          accountId: userAcc.id,
          direction: 'credit' as const,
          amount: quote.net,
          asset: req.asset,
        },
      ];
      if (isPositive(quote.platformFee)) {
        entries.push({
          accountId: feeAcc.id,
          direction: 'credit' as const,
          amount: quote.platformFee,
          asset: req.asset,
        });
      }
      await this.ledger.postJournal(manager, payment.id, entries);

      req.status = 'completed';
      req.feeAmount = quote.platformFee;
      return repo.save(req);
    });
  }

  /** Acepta solo imágenes en data URL y limita el tamaño (~2 MB base64). */
  private validateAttachment(raw?: string): string {
    if (!raw || !/^data:image\/(png|jpe?g|webp);base64,/.test(raw)) {
      throw new BadRequestException('La evidencia debe ser una imagen (png/jpg/webp)');
    }
    if (raw.length > 2_800_000) {
      throw new BadRequestException('La imagen es demasiado grande (máx. ~2 MB)');
    }
    return raw;
  }
}

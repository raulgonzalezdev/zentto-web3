import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { cmpStr, isPositive } from '../common/money.util';
import { LedgerConfig } from '../config/configuration';
import { PaymentEntity } from '../database/entities/payment.entity';
import { UserEntity } from '../database/entities/user.entity';
import { Balance, LedgerService } from '../ledger/ledger.service';

const SYSTEM_ISSUER = 'issuer';

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

@Injectable()
export class PaymentsService {
  private readonly cfg: LedgerConfig;

  constructor(
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<LedgerConfig>('ledger');
  }

  private assertAsset(asset: string): string {
    const a = asset.trim().toUpperCase();
    if (!this.cfg.assets.includes(a)) {
      throw new BadRequestException(
        `Asset no soportado: ${a}. Soportados: ${this.cfg.assets.join(', ')}`,
      );
    }
    return a;
  }

  private assertAmount(amount: string): void {
    if (!isPositive(amount)) throw new BadRequestException('El importe debe ser mayor que 0');
  }

  async getBalances(userId: string): Promise<Balance[]> {
    return Promise.all(
      this.cfg.assets.map((asset) => this.ledger.balanceFor('user', userId, asset)),
    );
  }

  async getPayment(userId: string, id: string): Promise<PaymentEntity> {
    const p = await this.payments.findOne({ where: { id } });
    if (!p || p.userId !== userId) throw new NotFoundException('Pago no encontrado');
    return p;
  }

  async listPayments(userId: string): Promise<PaymentEntity[]> {
    return this.payments.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  /**
   * Faucet de DESARROLLO: acredita saldo de prueba. Doble entrada: debita la
   * cuenta del sistema (emisor) y acredita al usuario. Idempotente por key.
   */
  async credit(
    userId: string,
    assetRaw: string,
    amount: string,
    idempotencyKey: string,
  ): Promise<PaymentEntity> {
    if (!this.cfg.faucetEnabled) {
      throw new ForbiddenException('Faucet deshabilitado (solo entornos de desarrollo)');
    }
    const asset = this.assertAsset(assetRaw);
    this.assertAmount(amount);
    if (cmpStr(amount, String(this.cfg.faucetMax)) > 0) {
      throw new BadRequestException(`Máximo por acreditación: ${this.cfg.faucetMax}`);
    }
    return this.runIdempotent(userId, idempotencyKey, async () => {
      return this.dataSource.transaction(async (manager) => {
        const issuer = await this.ledger.getOrCreateAccount(
          'system',
          SYSTEM_ISSUER,
          asset,
          manager,
        );
        const userAcc = await this.ledger.getOrCreateAccount('user', userId, asset, manager);

        const payment = manager.getRepository(PaymentEntity).create({
          id: randomUUID(),
          idempotencyKey,
          userId,
          type: 'credit',
          asset,
          amount,
          status: 'completed',
          fromAccountId: issuer.id,
          toAccountId: userAcc.id,
          counterparty: 'faucet',
          metadata: { faucet: true },
        });
        await manager.getRepository(PaymentEntity).save(payment);

        await this.ledger.postJournal(manager, payment.id, [
          { accountId: issuer.id, direction: 'debit', amount, asset },
          { accountId: userAcc.id, direction: 'credit', amount, asset },
        ]);
        return payment;
      });
    });
  }

  /**
   * Transferencia interna instantánea entre usuarios (asiento contable, sin
   * cadena). Idempotente y atómica: verifica disponible, debita emisor y
   * acredita receptor en la MISMA transacción de BD → nunca queda a medias.
   */
  async transfer(
    userId: string,
    toEmail: string,
    assetRaw: string,
    amount: string,
    idempotencyKey: string,
  ): Promise<PaymentEntity> {
    const asset = this.assertAsset(assetRaw);
    this.assertAmount(amount);

    const recipient = await this.users.findOne({ where: { email: toEmail.trim().toLowerCase() } });
    if (!recipient) throw new BadRequestException('El destinatario no existe');
    if (recipient.id === userId) throw new BadRequestException('No puedes transferirte a ti mismo');

    return this.runIdempotent(userId, idempotencyKey, async () => {
      return this.dataSource.transaction(async (manager) => {
        const from = await this.ledger.getOrCreateAccount('user', userId, asset, manager);
        const to = await this.ledger.getOrCreateAccount('user', recipient.id, asset, manager);

        const available = await this.ledger.availableOf(from.id, manager);
        if (cmpStr(available, amount) < 0) {
          throw new BadRequestException(`Saldo insuficiente: disponible ${available} ${asset}`);
        }

        const payment = manager.getRepository(PaymentEntity).create({
          id: randomUUID(),
          idempotencyKey,
          userId,
          type: 'transfer',
          asset,
          amount,
          status: 'completed',
          fromAccountId: from.id,
          toAccountId: to.id,
          counterparty: recipient.email,
        });
        await manager.getRepository(PaymentEntity).save(payment);

        await this.ledger.postJournal(manager, payment.id, [
          { accountId: from.id, direction: 'debit', amount, asset },
          { accountId: to.id, direction: 'credit', amount, asset },
        ]);
        return payment;
      });
    });
  }

  /**
   * Envoltura de idempotencia: si la key ya existe devuelve el pago previo; si
   * dos requests concurrentes chocan, la violación de unicidad se resuelve
   * releyendo el pago existente (nunca se duplica).
   */
  private async runIdempotent(
    userId: string,
    idempotencyKey: string,
    op: () => Promise<PaymentEntity>,
  ): Promise<PaymentEntity> {
    const existing = await this.payments.findOne({ where: { userId, idempotencyKey } });
    if (existing) return existing;
    try {
      return await op();
    } catch (e) {
      if (isUniqueViolation(e)) {
        const dup = await this.payments.findOne({ where: { userId, idempotencyKey } });
        if (dup) return dup;
      }
      throw e;
    }
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { isAddress } from 'viem';
import { AuthService } from '../auth/auth.service';
import { cmpStr, isPositive } from '../common/money.util';
import { WithdrawalsConfig } from '../config/configuration';
import { PaymentEntity } from '../database/entities/payment.entity';
import { WithdrawAddressEntity } from '../database/entities/withdraw-address.entity';
import { CustodyService } from '../custody/custody.service';
import { EvmService } from '../evm/evm.service';
import { FEE_ACCOUNT, FeeService } from '../fees/fee.service';
import { LedgerService } from '../ledger/ledger.service';

const WITHDRAWABLE_ASSET = 'USDC';
const SYSTEM_CUSTODY = 'custody';
/** Ventana de enfriamiento tras un cambio de contraseña antes de permitir retiros. */
const PASSWORD_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface WithdrawRequest {
  userId: string;
  asset: string;
  amount: string;
  toAddress: string;
  idempotencyKey: string;
  /** Red EVM de destino (key del catálogo: sepolia, polygon-amoy, bsc-testnet). */
  network?: string;
  /** Si viene, guarda la dirección como favorita con esta etiqueta. */
  saveLabel?: string;
  /** Código de Google Authenticator (TOTP) que autoriza el retiro. */
  totpCode?: string;
}

/**
 * Retiros on-chain con diseño anti-colgadas (estilo Binance):
 *
 *   request → HOLD (available baja al instante) → status `processing`
 *           → broadcast firmado (worker) → metadata.stage `broadcast` + txHash
 *           → reconciliación → `completed` (commit del hold + asiento de salida)
 *                            o `failed`  (release del hold = reembolso)
 *
 * El dinero NUNCA queda "en el aire": si el broadcast falla o la tx se revierte,
 * el hold se libera y el saldo del usuario vuelve intacto. El débito contable solo
 * se hace cuando la tx está confirmada on-chain.
 */
@Injectable()
export class WithdrawalsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WithdrawalsService.name);
  private readonly cfg: WithdrawalsConfig;
  private working = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(WithdrawAddressEntity)
    private readonly favorites: Repository<WithdrawAddressEntity>,
    private readonly ledger: LedgerService,
    private readonly custody: CustodyService,
    private readonly evm: EvmService,
    private readonly auth: AuthService,
    private readonly fees: FeeService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<WithdrawalsConfig>('withdrawals');
  }

  // ──────────────────────── Direcciones favoritas (B) ────────────────────────

  /** Lista las direcciones de retiro guardadas del usuario. */
  listFavorites(userId: string): Promise<WithdrawAddressEntity[]> {
    return this.favorites.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /** Guarda una dirección favorita (valida red + address EVM). Idempotente por unique. */
  async addFavorite(
    userId: string,
    input: { label: string; network?: string; address: string; asset?: string },
  ): Promise<WithdrawAddressEntity> {
    const label = (input.label ?? '').trim().slice(0, 64);
    if (!label) throw new BadRequestException('La etiqueta es obligatoria');
    if (!isAddress(input.address)) {
      throw new BadRequestException(`Address EVM inválida: ${input.address}`);
    }
    const network = this.evm.cfgOf(input.network).key; // valida red
    const existing = await this.favorites.findOne({
      where: { userId, network, address: input.address },
    });
    if (existing) {
      if (existing.label !== label) {
        existing.label = label;
        await this.favorites.save(existing);
      }
      return existing;
    }
    const entity = this.favorites.create({
      id: randomUUID(),
      userId,
      label,
      network,
      address: input.address,
      asset: (input.asset ?? 'USDC').toUpperCase().slice(0, 16),
    });
    return this.favorites.save(entity);
  }

  /** Elimina una dirección favorita del usuario. */
  async removeFavorite(userId: string, id: string): Promise<{ ok: boolean }> {
    const fav = await this.favorites.findOne({ where: { id } });
    if (!fav) throw new NotFoundException('Dirección no encontrada');
    if (fav.userId !== userId) throw new BadRequestException('No es tu dirección');
    await this.favorites.remove(fav);
    return { ok: true };
  }

  /**
   * Step-up auth + anti-fraude por cambio de clave reciente.
   *
   * 1) El retiro DEBE estar autorizado con Google Authenticator (TOTP): garantiza
   *    que sea el dueño de la cuenta quien autoriza la salida de fondos.
   * 2) Si la contraseña cambió hace < 24h (señal típica de toma de cuenta) y NO hay
   *    2FA activo, se rechaza el retiro: el atacante que reseteó la clave por email
   *    no podría además generar el código TOTP. Con 2FA activo, el TOTP ya cubre el
   *    riesgo y el retiro procede normalmente.
   *
   * Capas de seguridad de fondos adicionales ya presentes en el sistema:
   *   - Sesión por cookies httpOnly (no accesible por JS) + protección CSRF
   *     double-submit en mutaciones.
   *   - Holds/escrow: el saldo se retiene al instante; el débito contable solo se
   *     hace al confirmar on-chain. Si el broadcast falla, el hold se libera
   *     (reembolso automático): el dinero nunca queda "en el aire".
   *   - Idempotencia por `idempotencyKey`: reintentos no duplican retiros.
   */
  private async assertStepUp(userId: string, totpCode?: string): Promise<void> {
    const user = await this.auth.getById(userId);

    const changedRecently =
      !!user.passwordChangedAt &&
      Date.now() - user.passwordChangedAt.getTime() < PASSWORD_CHANGE_COOLDOWN_MS;

    if (!user.totpEnabled) {
      if (changedRecently) {
        throw new BadRequestException(
          'Cambiaste tu contraseña hace poco. Por seguridad, activa Google Authenticator (2FA) ' +
            'o espera 24 horas antes de retirar fondos.',
        );
      }
      throw new BadRequestException(
        'Habilita Google Authenticator (2FA) en tu cuenta antes de retirar fondos',
      );
    }
    if (!totpCode) {
      throw new BadRequestException(
        'Código de Google Authenticator requerido para autorizar el retiro',
      );
    }
    if (!this.auth.verifyTotp(user, totpCode)) {
      throw new UnauthorizedException('Código de Google Authenticator inválido');
    }
  }

  onModuleInit(): void {
    if (this.cfg.enabled && this.custody.enabled) {
      this.timer = setInterval(() => void this.runCycle().catch(() => undefined), 15_000);
      this.logger.log('Workers de retiros activos (broadcast + reconciliación cada 15s)');
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ─────────────────────────────── Solicitud ───────────────────────────────

  /** Crea un retiro: valida, coloca el hold y lo deja en `processing` (broadcast async). */
  async request(req: WithdrawRequest): Promise<PaymentEntity> {
    const { userId, asset, amount, toAddress, idempotencyKey, totpCode } = req;
    if (asset !== WITHDRAWABLE_ASSET) {
      throw new BadRequestException(
        `Solo se puede retirar ${WITHDRAWABLE_ASSET} on-chain por ahora`,
      );
    }
    if (!isPositive(amount)) throw new BadRequestException('El monto debe ser > 0');
    if (!isAddress(toAddress))
      throw new BadRequestException(`Address de destino inválida: ${toAddress}`);

    // Valida y normaliza la red (lanza si no es una red EVM operativa).
    const network = this.evm.cfgOf(req.network).key;

    const existing = await this.payments.findOne({ where: { userId, idempotencyKey } });
    if (existing) return existing;

    // Autorización fuerte (Google Authenticator) ANTES de mover nada.
    await this.assertStepUp(userId, totpCode);

    // Opcional (estilo Meru): guarda la dirección como favorita.
    if (req.saveLabel?.trim()) {
      await this.addFavorite(userId, {
        label: req.saveLabel,
        network,
        address: toAddress,
        asset,
      }).catch(() => undefined);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const userAcc = await this.ledger.getOrCreateAccount('user', userId, asset, manager);
        const available = await this.ledger.availableOf(userAcc.id, manager);
        // Comisión: plataforma + red. El usuario paga monto + comisiones (hold del total).
        const quote = this.fees.quoteWithdraw(amount);
        if (cmpStr(available, quote.total) < 0) {
          throw new BadRequestException(
            `Saldo insuficiente. Necesitas ${quote.total} ${asset} (incluye comisión ${quote.totalFee})`,
          );
        }

        const repo = manager.getRepository(PaymentEntity);
        const payment = repo.create({
          id: randomUUID(),
          idempotencyKey,
          userId,
          type: 'withdrawal',
          asset,
          amount,
          status: 'processing',
          fromAccountId: userAcc.id,
          toAccountId: null,
          counterparty: toAddress,
          metadata: {
            toAddress,
            network,
            stage: 'pending_broadcast',
            fee: quote.platformFee,
            networkFee: quote.networkFee,
            totalFee: quote.totalFee,
            totalDebit: quote.total,
          },
        });
        await repo.save(payment);

        const hold = await this.ledger.createHold(manager, userAcc.id, asset, quote.total, payment.id);
        payment.metadata = { ...payment.metadata, holdId: hold.id };
        await repo.save(payment);
        return payment;
      });
    } catch (e) {
      const code =
        (e as { code?: string; driverError?: { code?: string } })?.code ??
        (e as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '23505') {
        const dup = await this.payments.findOne({ where: { userId, idempotencyKey } });
        if (dup) return dup;
      }
      throw e;
    }
  }

  // ──────────────────────────────── Workers ────────────────────────────────

  /** Un ciclo completo: emite los pendientes y reconcilia los emitidos. */
  async runCycle(): Promise<{ broadcast: number; reconciled: number }> {
    if (this.working) return { broadcast: 0, reconciled: 0 };
    this.working = true;
    try {
      const broadcast = await this.processPending();
      const reconciled = await this.reconcile();
      return { broadcast, reconciled };
    } finally {
      this.working = false;
    }
  }

  private pending(stage: string): Promise<PaymentEntity[]> {
    return this.payments
      .createQueryBuilder('p')
      .where('p.type = :type AND p.status = :status', { type: 'withdrawal', status: 'processing' })
      .andWhere("p.metadata ->> 'stage' = :stage", { stage })
      .orderBy('p.createdAt', 'ASC')
      .limit(20)
      .getMany();
  }

  /** Firma y emite los retiros pendientes. Falla → release del hold (reembolso). */
  async processPending(): Promise<number> {
    const list = await this.pending('pending_broadcast');
    let n = 0;
    for (const p of list) {
      const toAddress = (p.metadata?.toAddress as string) ?? p.counterparty ?? '';
      const network = (p.metadata?.network as string) ?? undefined;
      // Marca 'broadcasting' para no reemitir si el ciclo se solapa.
      p.metadata = { ...p.metadata, stage: 'broadcasting' };
      await this.payments.save(p);
      try {
        const txHash = await this.custody.sendUsdc(toAddress, p.amount, network);
        p.metadata = { ...p.metadata, stage: 'broadcast', txHash };
        await this.payments.save(p);
        this.logger.log(`Retiro ${p.id} emitido: ${txHash}`);
        n++;
      } catch (err) {
        await this.failAndRefund(p, `broadcast: ${(err as Error).message}`);
        this.logger.warn(`Retiro ${p.id} falló al emitir, reembolsado: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /** Reconcilia los retiros emitidos contra la cadena: completa o reembolsa. */
  async reconcile(): Promise<number> {
    const list = await this.pending('broadcast');
    let n = 0;
    for (const p of list) {
      const txHash = p.metadata?.txHash as string | undefined;
      if (!txHash) continue;
      const network = (p.metadata?.network as string) ?? undefined;
      const minConf = (() => {
        try {
          return this.evm.cfgOf(network).confirmations;
        } catch {
          return this.cfg.confirmations;
        }
      })();
      const tx = await this.evm.getTransaction(txHash, network);
      if (tx.status === 'success' && tx.confirmations >= minConf) {
        await this.complete(p);
        n++;
      } else if (tx.status === 'reverted') {
        await this.failAndRefund(p, 'tx revertida on-chain');
        n++;
      }
      // pending / pocas confirmaciones: se deja para el próximo ciclo.
    }
    return n;
  }

  /** Confirmado: commit del hold + asiento de salida (debita total, acredita custodia + tesorería). */
  private async complete(p: PaymentEntity): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const userAcc = await this.ledger.getOrCreateAccount('user', p.userId, p.asset, manager);
      const custodyAcc = await this.ledger.getOrCreateAccount(
        'system',
        SYSTEM_CUSTODY,
        p.asset,
        manager,
      );
      const feeAcc = await this.ledger.getOrCreateAccount('system', FEE_ACCOUNT, p.asset, manager);
      const totalFee = (p.metadata?.totalFee as string) ?? '0';
      const totalDebit = (p.metadata?.totalDebit as string) ?? p.amount;
      const holdId = p.metadata?.holdId as string | undefined;
      if (holdId) await this.ledger.setHoldStatus(manager, holdId, 'committed');
      // Debita el total al usuario; el monto enviado va a custodia y la comisión a tesorería.
      const entries = [
        { accountId: userAcc.id, direction: 'debit' as const, amount: totalDebit, asset: p.asset },
        { accountId: custodyAcc.id, direction: 'credit' as const, amount: p.amount, asset: p.asset },
      ];
      if (isPositive(totalFee)) {
        entries.push({ accountId: feeAcc.id, direction: 'credit' as const, amount: totalFee, asset: p.asset });
      }
      await this.ledger.postJournal(manager, p.id, entries);
      await manager
        .getRepository(PaymentEntity)
        .update(
          { id: p.id },
          { status: 'completed', metadata: { ...p.metadata, stage: 'completed' } },
        );
    });
    this.logger.log(`Retiro ${p.id} completado`);
  }

  /** Fallo: libera el hold (reembolso) y marca failed. El saldo vuelve intacto. */
  private async failAndRefund(p: PaymentEntity, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const holdId = p.metadata?.holdId as string | undefined;
      if (holdId) await this.ledger.setHoldStatus(manager, holdId, 'released');
      await manager.getRepository(PaymentEntity).update(
        { id: p.id },
        {
          status: 'failed',
          failureReason: reason,
          metadata: { ...p.metadata, stage: 'failed' },
        },
      );
    });
  }
}

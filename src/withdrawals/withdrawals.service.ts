import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { isAddress } from 'viem';
import { cmpStr, isPositive } from '../common/money.util';
import { WithdrawalsConfig } from '../config/configuration';
import { PaymentEntity } from '../database/entities/payment.entity';
import { CustodyService } from '../custody/custody.service';
import { EvmService } from '../evm/evm.service';
import { LedgerService } from '../ledger/ledger.service';

const WITHDRAWABLE_ASSET = 'USDC';
const SYSTEM_CUSTODY = 'custody';

export interface WithdrawRequest {
  userId: string;
  asset: string;
  amount: string;
  toAddress: string;
  idempotencyKey: string;
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
    private readonly ledger: LedgerService,
    private readonly custody: CustodyService,
    private readonly evm: EvmService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<WithdrawalsConfig>('withdrawals');
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
    const { userId, asset, amount, toAddress, idempotencyKey } = req;
    if (asset !== WITHDRAWABLE_ASSET) {
      throw new BadRequestException(
        `Solo se puede retirar ${WITHDRAWABLE_ASSET} on-chain por ahora`,
      );
    }
    if (!isPositive(amount)) throw new BadRequestException('El monto debe ser > 0');
    if (!isAddress(toAddress))
      throw new BadRequestException(`Address de destino inválida: ${toAddress}`);

    const existing = await this.payments.findOne({ where: { userId, idempotencyKey } });
    if (existing) return existing;

    try {
      return await this.dataSource.transaction(async (manager) => {
        const userAcc = await this.ledger.getOrCreateAccount('user', userId, asset, manager);
        const available = await this.ledger.availableOf(userAcc.id, manager);
        if (cmpStr(available, amount) < 0) {
          throw new BadRequestException(`Saldo disponible insuficiente (${available} ${asset})`);
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
          metadata: { toAddress, stage: 'pending_broadcast' },
        });
        await repo.save(payment);

        const hold = await this.ledger.createHold(manager, userAcc.id, asset, amount, payment.id);
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
      // Marca 'broadcasting' para no reemitir si el ciclo se solapa.
      p.metadata = { ...p.metadata, stage: 'broadcasting' };
      await this.payments.save(p);
      try {
        const txHash = await this.custody.sendUsdc(toAddress, p.amount);
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
      const tx = await this.evm.getTransaction(txHash);
      if (tx.status === 'success' && tx.confirmations >= this.cfg.confirmations) {
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

  /** Confirmado: commit del hold + asiento de salida (debita usuario, acredita custodia). */
  private async complete(p: PaymentEntity): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const userAcc = await this.ledger.getOrCreateAccount('user', p.userId, p.asset, manager);
      const custodyAcc = await this.ledger.getOrCreateAccount(
        'system',
        SYSTEM_CUSTODY,
        p.asset,
        manager,
      );
      const holdId = p.metadata?.holdId as string | undefined;
      if (holdId) await this.ledger.setHoldStatus(manager, holdId, 'committed');
      await this.ledger.postJournal(manager, p.id, [
        { accountId: userAcc.id, direction: 'debit', amount: p.amount, asset: p.asset },
        { accountId: custodyAcc.id, direction: 'credit', amount: p.amount, asset: p.asset },
      ]);
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

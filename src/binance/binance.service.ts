import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { cmpStr, isPositive } from '../common/money.util';
import { BinanceLinkEntity } from '../database/entities/binance-link.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { FEE_ACCOUNT, FeeService } from '../fees/fee.service';
import { LedgerService } from '../ledger/ledger.service';
import { BinancePayService } from './binance-pay.service';

/** Cuenta de sistema que representa los fondos en Binance Pay. */
const SYSTEM_BINANCE = 'binance';
const CURRENCY = 'USDT';

/**
 * Conecta la cuenta Binance del usuario (vía Binance Pay) para recargar saldo
 * desde Binance y retirar a Binance por su ID/correo (estilo Meru). Todo el dinero
 * se mueve en el ledger con comisión a tesorería. Gated por credenciales de Binance.
 */
@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);

  constructor(
    @InjectRepository(BinanceLinkEntity) private readonly links: Repository<BinanceLinkEntity>,
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    private readonly pay: BinancePayService,
    private readonly ledger: LedgerService,
    private readonly fees: FeeService,
    private readonly auth: AuthService,
    private readonly dataSource: DataSource,
  ) {}

  get available(): boolean {
    return this.pay.enabled;
  }

  /** Vincula la cuenta Binance del usuario (Binance Pay ID o correo). */
  async link(userId: string, account: string, accountType: 'email' | 'pay_id') {
    const value = (account ?? '').trim();
    if (!value) throw new BadRequestException('Indica tu Binance Pay ID o correo');
    const entity = this.links.create({
      userId,
      binanceAccount: value,
      accountType,
      status: 'linked',
    });
    await this.links.save(entity);
    return { ok: true, binanceAccount: value, accountType };
  }

  async status(userId: string) {
    const link = await this.links.findOne({ where: { userId } });
    return {
      available: this.available,
      linked: !!link && link.status === 'linked',
      binanceAccount: link?.binanceAccount ?? null,
      accountType: link?.accountType ?? null,
    };
  }

  /**
   * Recarga desde Binance: crea una orden Binance Pay. El usuario paga en Binance
   * (deeplink/QR) y el webhook acredita el saldo. Devuelve los datos de checkout.
   */
  async recharge(userId: string, amount: string) {
    if (!isPositive(amount)) throw new BadRequestException('El monto debe ser > 0');
    const merchantTradeNo = `bnc${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    // Registro pendiente (se completa en el webhook, idempotente por merchantTradeNo).
    await this.payments.save(
      this.payments.create({
        id: randomUUID(),
        idempotencyKey: `binance-recharge:${merchantTradeNo}`,
        userId,
        type: 'recharge',
        asset: CURRENCY,
        amount,
        status: 'processing',
        counterparty: 'binance_pay',
        metadata: { provider: 'binance_pay', merchantTradeNo, stage: 'pending' },
      }),
    );
    const order = await this.pay.createOrder({
      merchantTradeNo,
      amount,
      currency: CURRENCY,
      goods: 'Recarga Zentto',
    });
    return { merchantTradeNo, ...order };
  }

  /** Webhook de Binance Pay: acredita la recarga al confirmarse el pago. */
  async handlePaidWebhook(merchantTradeNo: string): Promise<void> {
    const payment = await this.payments.findOne({
      where: { idempotencyKey: `binance-recharge:${merchantTradeNo}` },
    });
    if (!payment || payment.status === 'completed') return; // idempotente

    await this.dataSource.transaction(async (manager) => {
      const binanceAcc = await this.ledger.getOrCreateAccount(
        'system',
        SYSTEM_BINANCE,
        payment.asset,
        manager,
      );
      const userAcc = await this.ledger.getOrCreateAccount(
        'user',
        payment.userId,
        payment.asset,
        manager,
      );
      const feeAcc = await this.ledger.getOrCreateAccount(
        'system',
        FEE_ACCOUNT,
        payment.asset,
        manager,
      );
      const quote = this.fees.quoteDeposit(payment.amount);
      const entries = [
        {
          accountId: binanceAcc.id,
          direction: 'debit' as const,
          amount: payment.amount,
          asset: payment.asset,
        },
        {
          accountId: userAcc.id,
          direction: 'credit' as const,
          amount: quote.net,
          asset: payment.asset,
        },
      ];
      if (isPositive(quote.platformFee)) {
        entries.push({
          accountId: feeAcc.id,
          direction: 'credit' as const,
          amount: quote.platformFee,
          asset: payment.asset,
        });
      }
      await this.ledger.postJournal(manager, payment.id, entries);
      await manager.getRepository(PaymentEntity).update(
        { id: payment.id },
        {
          status: 'completed',
          amount: quote.net,
          metadata: {
            ...payment.metadata,
            stage: 'completed',
            grossAmount: payment.amount,
            fee: quote.platformFee,
          },
        },
      );
    });
    this.logger.log(`Recarga Binance ${merchantTradeNo} acreditada`);
  }

  /**
   * Retira a Binance por payout (al ID/correo vinculado). Exige 2FA. Debita el
   * total (monto + comisión) tras un payout exitoso.
   */
  async withdraw(userId: string, amount: string, totpCode?: string) {
    if (!isPositive(amount)) throw new BadRequestException('El monto debe ser > 0');
    await this.auth.assertStepUp(userId, totpCode);
    const link = await this.links.findOne({ where: { userId, status: 'linked' } });
    if (!link) throw new BadRequestException('Primero vincula tu cuenta Binance');

    const quote = this.fees.quoteWithdraw(amount);
    const acc = await this.ledger.getOrCreateAccount('user', userId, CURRENCY);
    const avail = await this.ledger.availableOf(acc.id);
    if (cmpStr(avail, quote.total) < 0) {
      throw new BadRequestException(`Saldo insuficiente. Necesitas ${quote.total} ${CURRENCY}`);
    }

    const requestId = `bncpo${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    // El payout externo va primero; si falla, no se debita nada.
    const res = await this.pay.payout({
      requestId,
      amount,
      currency: CURRENCY,
      receiveType: link.accountType === 'email' ? 'EMAIL' : 'BINANCE_ID',
      receiver: link.binanceAccount,
    });

    await this.dataSource.transaction(async (manager) => {
      const userAcc = await this.ledger.getOrCreateAccount('user', userId, CURRENCY, manager);
      const binanceAcc = await this.ledger.getOrCreateAccount(
        'system',
        SYSTEM_BINANCE,
        CURRENCY,
        manager,
      );
      const feeAcc = await this.ledger.getOrCreateAccount('system', FEE_ACCOUNT, CURRENCY, manager);
      const entries = [
        {
          accountId: userAcc.id,
          direction: 'debit' as const,
          amount: quote.total,
          asset: CURRENCY,
        },
        { accountId: binanceAcc.id, direction: 'credit' as const, amount, asset: CURRENCY },
      ];
      if (isPositive(quote.totalFee)) {
        entries.push({
          accountId: feeAcc.id,
          direction: 'credit' as const,
          amount: quote.totalFee,
          asset: CURRENCY,
        });
      }
      const payment = manager.getRepository(PaymentEntity).create({
        id: randomUUID(),
        idempotencyKey: `binance-payout:${requestId}`,
        userId,
        type: 'withdrawal',
        asset: CURRENCY,
        amount,
        status: 'completed',
        counterparty: link.binanceAccount,
        metadata: {
          provider: 'binance_pay',
          requestId,
          fee: quote.totalFee,
          receiver: link.binanceAccount,
        },
      });
      await manager.getRepository(PaymentEntity).save(payment);
      await this.ledger.postJournal(manager, payment.id, entries);
    });
    this.logger.log(`Retiro Binance ${requestId} → ${link.binanceAccount} (${res.status})`);
    return { ok: true, requestId };
  }
}

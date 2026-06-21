import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { cmpStr, isPositive } from '../common/money.util';
import { LedgerConfig } from '../config/configuration';
import { FEE_ACCOUNT, FeeService } from '../fees/fee.service';
import { P2pMessageEntity } from '../database/entities/p2p-message.entity';
import { P2pOrderEntity, P2pSide } from '../database/entities/p2p-order.entity';
import { P2pTradeEntity } from '../database/entities/p2p-trade.entity';
import { UserEntity } from '../database/entities/user.entity';
import { LedgerService } from '../ledger/ledger.service';

export interface CreateOrderInput {
  side: P2pSide;
  asset: string;
  amount: string;
  priceVes: string;
  paymentMethod?: string; // etiqueta pública (banco/método)
  paymentDetails?: string; // datos completos (privados, se revelan al tomar)
}

/**
 * Mercado P2P (estilo Binance P2P) sobre el ledger del neobanco. Las ofertas de
 * VENTA escrowan el cripto del maker con un hold; al tomar una oferta se crea un
 * trade y el cripto del vendedor queda retenido hasta que confirma el pago fiat
 * (off-platform), momento en que se libera al comprador con un asiento contable.
 *
 * (Distinto de la red P2P del blockchain en src/p2p/, que es gossip de bloques.)
 */
/** Ventanas de tiempo del escrow (anti-colgado / arbitraje). */
const PAYMENT_WINDOW_MS = 15 * 60_000; // comprador: marcar pagado en 15 min
const RELEASE_WINDOW_MS = 30 * 60_000; // vendedor: liberar en 30 min tras el pago
const EXTENSION_MS = 15 * 60_000; // cada extensión añade 15 min
const MAX_EXTENSIONS = 2; // tope de extensiones antes de forzar disputa

/** Referencia de precio de mercado (USDT/VES). Cache para no golpear el proveedor. */
const RATE_TTL_MS = 5 * 60_000;
const RATE_SOURCES = [
  'https://ve.dolarapi.com/v1/dolares/paralelo',
  'https://ve.dolarapi.com/v1/dolares/oficial',
];

export interface MarketRate {
  usdtVes: number | null;
  source: string | null;
  updatedAt: string | null;
  bandPct: number;
  min: number | null;
  max: number | null;
}

@Injectable()
export class P2pMarketService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(P2pMarketService.name);
  private readonly assets: string[];
  private readonly bandPct: number;
  private timer?: NodeJS.Timeout;
  private sweeping = false;
  private rateCache: { rate: number; source: string; at: number } | null = null;

  constructor(
    @InjectRepository(P2pOrderEntity) private readonly orders: Repository<P2pOrderEntity>,
    @InjectRepository(P2pTradeEntity) private readonly trades: Repository<P2pTradeEntity>,
    @InjectRepository(P2pMessageEntity) private readonly messages: Repository<P2pMessageEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly ledger: LedgerService,
    private readonly auth: AuthService,
    private readonly fees: FeeService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.assets = config.getOrThrow<LedgerConfig>('ledger').assets;
    // Banda anti-especulación: el precio no puede desviarse más de este % del mercado.
    const raw = Number(config.get<string>('P2P_PRICE_BAND_PCT') ?? '0.15');
    this.bandPct = Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.15;
  }

  onModuleInit(): void {
    // Worker de timeouts del escrow: cada 60s revisa ventanas vencidas.
    this.timer = setInterval(() => void this.sweepTimeouts().catch(() => undefined), 60_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async emails(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.users.find({ where: { id: In(userIds) }, select: ['id', 'email'] });
    return new Map(rows.map((u) => [u.id, u.email]));
  }

  // ─────────────────────────────── Órdenes ───────────────────────────────

  async createOrder(userId: string, input: CreateOrderInput): Promise<P2pOrderEntity> {
    const { side, asset, amount, priceVes, paymentMethod, paymentDetails } = input;
    if (side !== 'buy' && side !== 'sell') throw new BadRequestException('side inválido');
    if (!this.assets.includes(asset)) throw new BadRequestException(`Asset no soportado: ${asset}`);
    if (!isPositive(amount)) throw new BadRequestException('amount debe ser > 0');
    if (!isPositive(priceVes)) throw new BadRequestException('priceVes debe ser > 0');

    // Banda anti-especulación: rechaza precios fuera del rango del mercado.
    const market = await this.getMarketRate();
    if (market.min !== null && market.max !== null) {
      const p = Number(priceVes);
      if (p < market.min || p > market.max) {
        throw new BadRequestException(
          `Precio fuera de rango. El mercado está en ~${market.usdtVes} Bs.; ` +
            `permitido entre ${market.min.toFixed(2)} y ${market.max.toFixed(2)} Bs.`,
        );
      }
    }

    return this.dataSource.transaction(async (manager) => {
      let holdId: string | null = null;
      if (side === 'sell') {
        const acc = await this.ledger.getOrCreateAccount('user', userId, asset, manager);
        const available = await this.ledger.availableOf(acc.id, manager);
        if (cmpStr(available, amount) < 0) {
          throw new BadRequestException(`Saldo disponible insuficiente (${available} ${asset})`);
        }
        const hold = await this.ledger.createHold(manager, acc.id, asset, amount, null);
        holdId = hold.id;
      }
      const order = manager.getRepository(P2pOrderEntity).create({
        id: randomUUID(),
        makerUserId: userId,
        side,
        asset,
        amount,
        priceVes,
        paymentMethod: paymentMethod ?? null,
        paymentDetails: paymentDetails?.slice(0, 600) ?? null,
        status: 'open',
        holdId,
      });
      return manager.getRepository(P2pOrderEntity).save(order);
    });
  }

  /** Order book público: ofertas abiertas (filtro opcional). */
  async listOpen(filter: { side?: string; asset?: string }) {
    const where: Record<string, unknown> = { status: 'open' };
    if (filter.side) where.side = filter.side;
    if (filter.asset) where.asset = filter.asset;
    const rows = await this.orders.find({ where, order: { createdAt: 'DESC' }, take: 200 });
    const emails = await this.emails(rows.map((r) => r.makerUserId));
    // PRIVACIDAD (estilo Binance): el libro público nunca expone los datos de pago
    // completos — solo la etiqueta del método. Los datos se revelan al tomar la oferta.
    return rows.map(({ paymentDetails: _omit, ...r }) => ({
      ...r,
      makerEmail: emails.get(r.makerUserId) ?? null,
    }));
  }

  async listMine(userId: string) {
    return this.orders.find({
      where: { makerUserId: userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async cancelOrder(userId: string, orderId: string): Promise<{ ok: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(P2pOrderEntity);
      const order = await repo.findOne({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Orden no encontrada');
      if (order.makerUserId !== userId) throw new ForbiddenException('No es tu orden');
      if (order.status !== 'open') throw new BadRequestException('La orden ya no está abierta');
      if (order.holdId) await this.ledger.setHoldStatus(manager, order.holdId, 'released');
      order.status = 'cancelled';
      await repo.save(order);
      return { ok: true };
    });
  }

  // ──────────────────────────────── Trades ────────────────────────────────

  /** Toma una oferta completa: crea el trade y escrowa el cripto del vendedor. */
  async takeOrder(takerId: string, orderId: string): Promise<P2pTradeEntity> {
    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(P2pOrderEntity);
      const order = await orderRepo.findOne({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Orden no encontrada');
      if (order.status !== 'open') throw new BadRequestException('La orden ya no está disponible');
      if (order.makerUserId === takerId) {
        throw new BadRequestException('No puedes tomar tu propia orden');
      }

      const buyerUserId = order.side === 'sell' ? takerId : order.makerUserId;
      const sellerUserId = order.side === 'sell' ? order.makerUserId : takerId;

      let holdId: string | null;
      if (order.side === 'sell') {
        holdId = order.holdId; // ya escrowado al publicar
      } else {
        // Oferta de compra: el taker es el vendedor → escrowar ahora.
        const acc = await this.ledger.getOrCreateAccount(
          'user',
          sellerUserId,
          order.asset,
          manager,
        );
        const available = await this.ledger.availableOf(acc.id, manager);
        if (cmpStr(available, order.amount) < 0) {
          throw new BadRequestException(
            `Saldo disponible insuficiente (${available} ${order.asset})`,
          );
        }
        const hold = await this.ledger.createHold(manager, acc.id, order.asset, order.amount, null);
        holdId = hold.id;
      }

      order.status = 'taken';
      await orderRepo.save(order);

      const trade = manager.getRepository(P2pTradeEntity).create({
        id: randomUUID(),
        orderId: order.id,
        buyerUserId,
        sellerUserId,
        asset: order.asset,
        amount: order.amount,
        priceVes: order.priceVes,
        status: 'pending',
        holdId,
        paymentDeadline: new Date(Date.now() + PAYMENT_WINDOW_MS),
      });
      return manager.getRepository(P2pTradeEntity).save(trade);
    });
  }

  /** El VENDEDOR confirma que recibió el fiat → libera el cripto al comprador. */
  async confirmTrade(userId: string, tradeId: string, totpCode?: string): Promise<{ ok: boolean }> {
    // Liberar cripto mueve fondos → segundo factor obligatorio (Google Authenticator).
    await this.auth.assertStepUp(userId, totpCode);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(P2pTradeEntity);
      const trade = await repo.findOne({ where: { id: tradeId } });
      if (!trade) throw new NotFoundException('Trade no encontrado');
      if (trade.sellerUserId !== userId) {
        throw new ForbiddenException('Solo el vendedor confirma el pago recibido');
      }
      if (trade.status !== 'pending' && trade.status !== 'paid')
        throw new BadRequestException('El trade ya no admite confirmación');

      const sellerAcc = await this.ledger.getOrCreateAccount(
        'user',
        trade.sellerUserId,
        trade.asset,
        manager,
      );
      const buyerAcc = await this.ledger.getOrCreateAccount(
        'user',
        trade.buyerUserId,
        trade.asset,
        manager,
      );
      // Comisión de plataforma: el comprador recibe el neto; la comisión va a tesorería.
      const quote = this.fees.quoteP2p(trade.amount);
      const feeAcc = await this.ledger.getOrCreateAccount('system', FEE_ACCOUNT, trade.asset, manager);
      if (trade.holdId) await this.ledger.setHoldStatus(manager, trade.holdId, 'committed');
      const entries = [
        { accountId: sellerAcc.id, direction: 'debit' as const, amount: trade.amount, asset: trade.asset },
        { accountId: buyerAcc.id, direction: 'credit' as const, amount: quote.net, asset: trade.asset },
      ];
      if (isPositive(quote.platformFee)) {
        entries.push({
          accountId: feeAcc.id,
          direction: 'credit' as const,
          amount: quote.platformFee,
          asset: trade.asset,
        });
      }
      await this.ledger.postJournal(manager, trade.id, entries);
      trade.feeAmount = quote.platformFee;
      trade.status = 'completed';
      await repo.save(trade);
      return { ok: true };
    });
  }

  /** Cancela un trade pendiente (libera el escrow, sin mover cripto). */
  async cancelTrade(userId: string, tradeId: string): Promise<{ ok: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(P2pTradeEntity);
      const trade = await repo.findOne({ where: { id: tradeId } });
      if (!trade) throw new NotFoundException('Trade no encontrado');
      if (trade.buyerUserId !== userId && trade.sellerUserId !== userId) {
        throw new ForbiddenException('No participas en este trade');
      }
      if (trade.status !== 'pending')
        throw new BadRequestException('El trade ya no está pendiente');
      if (trade.holdId) await this.ledger.setHoldStatus(manager, trade.holdId, 'released');
      trade.status = 'cancelled';
      await repo.save(trade);
      return { ok: true };
    });
  }

  /** El COMPRADOR marca que pagó el fiat → inicia la ventana de liberación. */
  async markPaid(userId: string, tradeId: string): Promise<{ ok: boolean }> {
    const trade = await this.trades.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException('Trade no encontrado');
    if (trade.buyerUserId !== userId)
      throw new ForbiddenException('Solo el comprador marca el pago');
    if (trade.status !== 'pending') throw new BadRequestException('El trade ya no está pendiente');
    trade.status = 'paid';
    trade.paidAt = new Date();
    trade.releaseDeadline = new Date(Date.now() + RELEASE_WINDOW_MS);
    await this.trades.save(trade);
    return { ok: true };
  }

  /**
   * Extiende la ventana de tiempo activa (pago o liberación) +15 min. Cualquiera de
   * las partes puede hacerlo, hasta MAX_EXTENSIONS veces. Agotadas las extensiones,
   * el worker escala a disputa. Devuelve los límites y extensiones restantes.
   */
  async extendTrade(
    userId: string,
    tradeId: string,
  ): Promise<{ ok: boolean; extensions: number; extensionsLeft: number; deadline: Date | null }> {
    const trade = await this.trades.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException('Trade no encontrado');
    if (trade.buyerUserId !== userId && trade.sellerUserId !== userId) {
      throw new ForbiddenException('No participas en este trade');
    }
    if (trade.status !== 'pending' && trade.status !== 'paid') {
      throw new BadRequestException('Solo se puede extender un trade en espera');
    }
    if (trade.extensions >= MAX_EXTENSIONS) {
      throw new BadRequestException(
        'Se agotaron las extensiones de tiempo. Si hay un problema, abre una disputa.',
      );
    }
    const now = Date.now();
    if (trade.status === 'pending') {
      const base = trade.paymentDeadline ? trade.paymentDeadline.getTime() : now;
      trade.paymentDeadline = new Date(Math.max(base, now) + EXTENSION_MS);
    } else {
      const base = trade.releaseDeadline ? trade.releaseDeadline.getTime() : now;
      trade.releaseDeadline = new Date(Math.max(base, now) + EXTENSION_MS);
    }
    trade.extensions += 1;
    await this.trades.save(trade);
    return {
      ok: true,
      extensions: trade.extensions,
      extensionsLeft: MAX_EXTENSIONS - trade.extensions,
      deadline: trade.status === 'pending' ? trade.paymentDeadline : trade.releaseDeadline,
    };
  }

  /** Cualquier parte abre una disputa (la resuelve un árbitro). El escrow sigue retenido. */
  async openDispute(userId: string, tradeId: string, reason: string): Promise<{ ok: boolean }> {
    const trade = await this.trades.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException('Trade no encontrado');
    if (trade.buyerUserId !== userId && trade.sellerUserId !== userId) {
      throw new ForbiddenException('No participas en este trade');
    }
    if (trade.status !== 'pending' && trade.status !== 'paid') {
      throw new BadRequestException('El trade no admite disputa en su estado actual');
    }
    trade.status = 'disputed';
    trade.disputeReason = (reason || '').slice(0, 1000) || null;
    trade.disputeBy = userId;
    await this.trades.save(trade);
    return { ok: true };
  }

  /** ÁRBITRO (operador): resuelve la disputa — 'release' al comprador o 'refund' al vendedor. */
  async resolveDispute(
    arbiterId: string,
    tradeId: string,
    decision: 'release' | 'refund',
  ): Promise<{ ok: boolean }> {
    if (decision !== 'release' && decision !== 'refund') {
      throw new BadRequestException('Decisión inválida');
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(P2pTradeEntity);
      const trade = await repo.findOne({ where: { id: tradeId } });
      if (!trade) throw new NotFoundException('Trade no encontrado');
      if (trade.status !== 'disputed') throw new BadRequestException('El trade no está en disputa');
      if (decision === 'release') {
        const sellerAcc = await this.ledger.getOrCreateAccount(
          'user',
          trade.sellerUserId,
          trade.asset,
          manager,
        );
        const buyerAcc = await this.ledger.getOrCreateAccount(
          'user',
          trade.buyerUserId,
          trade.asset,
          manager,
        );
        const quote = this.fees.quoteP2p(trade.amount);
        const feeAcc = await this.ledger.getOrCreateAccount('system', FEE_ACCOUNT, trade.asset, manager);
        if (trade.holdId) await this.ledger.setHoldStatus(manager, trade.holdId, 'committed');
        const entries = [
          { accountId: sellerAcc.id, direction: 'debit' as const, amount: trade.amount, asset: trade.asset },
          { accountId: buyerAcc.id, direction: 'credit' as const, amount: quote.net, asset: trade.asset },
        ];
        if (isPositive(quote.platformFee)) {
          entries.push({
            accountId: feeAcc.id,
            direction: 'credit' as const,
            amount: quote.platformFee,
            asset: trade.asset,
          });
        }
        await this.ledger.postJournal(manager, trade.id, entries);
        trade.feeAmount = quote.platformFee;
        trade.status = 'completed';
      } else {
        if (trade.holdId) await this.ledger.setHoldStatus(manager, trade.holdId, 'released');
        trade.status = 'cancelled';
      }
      trade.resolvedBy = arbiterId;
      trade.resolution = decision === 'release' ? 'released' : 'refunded';
      await repo.save(trade);
      return { ok: true };
    });
  }

  /** Cola de disputas para el árbitro (con emails de las partes). */
  async listDisputes() {
    const rows = await this.trades.find({
      where: { status: 'disputed' },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const emails = await this.emails(rows.flatMap((r) => [r.buyerUserId, r.sellerUserId]));
    return rows.map((r) => ({
      ...r,
      buyerEmail: emails.get(r.buyerUserId) ?? null,
      sellerEmail: emails.get(r.sellerUserId) ?? null,
    }));
  }

  /** Worker: vence ventanas. Sin pago → reembolsa al vendedor; sin liberación → disputa. */
  private async sweepTimeouts(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = new Date();
      const expiredPending = await this.trades.find({
        where: { status: 'pending', paymentDeadline: LessThan(now) },
        take: 50,
      });
      for (const t of expiredPending) {
        // Si hubo interacción (chat o extensiones), el caso es ambiguo → disputa
        // para que un árbitro decida. Sin interacción → reembolso al vendedor.
        const engaged =
          t.extensions > 0 || (await this.messages.count({ where: { tradeId: t.id } })) > 0;
        if (engaged) {
          const fresh = await this.trades.findOne({ where: { id: t.id } });
          if (!fresh || fresh.status !== 'pending') continue;
          fresh.status = 'disputed';
          fresh.disputeReason = 'Venció el tiempo de pago con la operación en curso (escalado automático)';
          fresh.disputeBy = fresh.sellerUserId;
          await this.trades.save(fresh);
          this.logger.log(`Trade ${t.id} escalado a disputa (venció el pago con interacción)`);
          continue;
        }
        await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(P2pTradeEntity);
          const fresh = await repo.findOne({ where: { id: t.id } });
          if (!fresh || fresh.status !== 'pending') return;
          if (fresh.holdId) await this.ledger.setHoldStatus(manager, fresh.holdId, 'released');
          fresh.status = 'expired';
          await repo.save(fresh);
        });
        this.logger.log(`Trade ${t.id} expiró sin pago → reembolsado al vendedor`);
      }
      const overdueRelease = await this.trades.find({
        where: { status: 'paid', releaseDeadline: LessThan(now) },
        take: 50,
      });
      for (const t of overdueRelease) {
        const fresh = await this.trades.findOne({ where: { id: t.id } });
        if (!fresh || fresh.status !== 'paid') continue;
        fresh.status = 'disputed';
        fresh.disputeReason = 'El vendedor no liberó en el tiempo establecido (escalado automático)';
        fresh.disputeBy = fresh.buyerUserId;
        await this.trades.save(fresh);
        this.logger.log(`Trade ${t.id} escalado a disputa (vendedor no liberó a tiempo)`);
      }
    } finally {
      this.sweeping = false;
    }
  }

  async myTrades(userId: string) {
    return this.trades.find({
      where: [{ buyerUserId: userId }, { sellerUserId: userId }],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async getTrade(userId: string, tradeId: string, isOperator = false) {
    const trade = await this.trades.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException('Trade no encontrado');
    if (!isOperator && trade.buyerUserId !== userId && trade.sellerUserId !== userId) {
      throw new ForbiddenException('No participas en este trade');
    }
    const emails = await this.emails([trade.buyerUserId, trade.sellerUserId]);
    // Una vez creado el trade, las partes SÍ ven los datos de pago completos del maker.
    const order = await this.orders.findOne({ where: { id: trade.orderId } });
    return {
      ...trade,
      buyerEmail: emails.get(trade.buyerUserId) ?? null,
      sellerEmail: emails.get(trade.sellerUserId) ?? null,
      paymentMethod: order?.paymentMethod ?? null,
      paymentDetails: order?.paymentDetails ?? null,
      maxExtensions: MAX_EXTENSIONS,
      extensionsLeft: Math.max(0, MAX_EXTENSIONS - trade.extensions),
    };
  }

  // ─────────────────────── Referencia de mercado ───────────────────────

  /** Precio de mercado USDT/VES (con cache) + límites de la banda anti-especulación. */
  async getMarketRate(): Promise<MarketRate> {
    const fresh =
      this.rateCache && Date.now() - this.rateCache.at < RATE_TTL_MS ? this.rateCache : null;
    const cached = fresh ?? (await this.fetchRate());
    if (!cached) {
      return { usdtVes: null, source: null, updatedAt: null, bandPct: this.bandPct, min: null, max: null };
    }
    return {
      usdtVes: cached.rate,
      source: cached.source,
      updatedAt: new Date(cached.at).toISOString(),
      bandPct: this.bandPct,
      min: cached.rate * (1 - this.bandPct),
      max: cached.rate * (1 + this.bandPct),
    };
  }

  /** Consulta el proveedor público de tasa VES; tolerante a fallos (devuelve null). */
  private async fetchRate(): Promise<{ rate: number; source: string; at: number } | null> {
    for (const url of RATE_SOURCES) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
        if (!res.ok) continue;
        const data = (await res.json()) as { promedio?: number; precio?: number };
        const rate = Number(data.promedio ?? data.precio);
        if (Number.isFinite(rate) && rate > 0) {
          this.rateCache = { rate, source: url, at: Date.now() };
          return this.rateCache;
        }
      } catch {
        // proveedor caído / timeout → probar el siguiente
      }
    }
    return null;
  }

  // ─────────────────────────── Chat del trade ───────────────────────────

  /** Mensajes del chat de un trade (solo partes; el árbitro si es operador). */
  async listMessages(userId: string, tradeId: string, isOperator = false) {
    const trade = await this.trades.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException('Trade no encontrado');
    if (!isOperator && trade.buyerUserId !== userId && trade.sellerUserId !== userId) {
      throw new ForbiddenException('No participas en este trade');
    }
    return this.messages.find({ where: { tradeId }, order: { createdAt: 'ASC' }, take: 500 });
  }

  /** Publica un mensaje (texto y/o evidencia de pago) en el chat del trade. */
  async postMessage(
    userId: string,
    tradeId: string,
    input: { body?: string; attachment?: string },
    isOperator = false,
  ): Promise<P2pMessageEntity> {
    const trade = await this.trades.findOne({ where: { id: tradeId } });
    if (!trade) throw new NotFoundException('Trade no encontrado');
    if (!isOperator && trade.buyerUserId !== userId && trade.sellerUserId !== userId) {
      throw new ForbiddenException('No participas en este trade');
    }
    const body = (input.body ?? '').trim().slice(0, 2000) || null;
    const attachment = this.validateAttachment(input.attachment);
    if (!body && !attachment) throw new BadRequestException('Mensaje vacío');
    const msg = this.messages.create({
      id: randomUUID(),
      tradeId,
      senderUserId: userId,
      body,
      attachment,
    });
    return this.messages.save(msg);
  }

  /** Acepta solo imágenes en data URL y limita el tamaño (~2 MB base64). */
  private validateAttachment(raw?: string): string | null {
    if (!raw) return null;
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(raw)) {
      throw new BadRequestException('La evidencia debe ser una imagen (png/jpg/webp)');
    }
    if (raw.length > 2_800_000) {
      throw new BadRequestException('La imagen es demasiado grande (máx. ~2 MB)');
    }
    return raw;
  }
}

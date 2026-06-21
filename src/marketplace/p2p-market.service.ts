import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { cmpStr, isPositive } from '../common/money.util';
import { LedgerConfig } from '../config/configuration';
import { P2pOrderEntity, P2pSide } from '../database/entities/p2p-order.entity';
import { P2pTradeEntity } from '../database/entities/p2p-trade.entity';
import { UserEntity } from '../database/entities/user.entity';
import { LedgerService } from '../ledger/ledger.service';

export interface CreateOrderInput {
  side: P2pSide;
  asset: string;
  amount: string;
  priceVes: string;
  paymentMethod?: string;
}

/**
 * Mercado P2P (estilo Binance P2P) sobre el ledger del neobanco. Las ofertas de
 * VENTA escrowan el cripto del maker con un hold; al tomar una oferta se crea un
 * trade y el cripto del vendedor queda retenido hasta que confirma el pago fiat
 * (off-platform), momento en que se libera al comprador con un asiento contable.
 *
 * (Distinto de la red P2P del blockchain en src/p2p/, que es gossip de bloques.)
 */
@Injectable()
export class P2pMarketService {
  private readonly assets: string[];

  constructor(
    @InjectRepository(P2pOrderEntity) private readonly orders: Repository<P2pOrderEntity>,
    @InjectRepository(P2pTradeEntity) private readonly trades: Repository<P2pTradeEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.assets = config.getOrThrow<LedgerConfig>('ledger').assets;
  }

  private async emails(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.users.find({ where: { id: In(userIds) }, select: ['id', 'email'] });
    return new Map(rows.map((u) => [u.id, u.email]));
  }

  // ─────────────────────────────── Órdenes ───────────────────────────────

  async createOrder(userId: string, input: CreateOrderInput): Promise<P2pOrderEntity> {
    const { side, asset, amount, priceVes, paymentMethod } = input;
    if (side !== 'buy' && side !== 'sell') throw new BadRequestException('side inválido');
    if (!this.assets.includes(asset)) throw new BadRequestException(`Asset no soportado: ${asset}`);
    if (!isPositive(amount)) throw new BadRequestException('amount debe ser > 0');
    if (!isPositive(priceVes)) throw new BadRequestException('priceVes debe ser > 0');

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
    return rows.map((r) => ({ ...r, makerEmail: emails.get(r.makerUserId) ?? null }));
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
      });
      return manager.getRepository(P2pTradeEntity).save(trade);
    });
  }

  /** El VENDEDOR confirma que recibió el fiat → libera el cripto al comprador. */
  async confirmTrade(userId: string, tradeId: string): Promise<{ ok: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(P2pTradeEntity);
      const trade = await repo.findOne({ where: { id: tradeId } });
      if (!trade) throw new NotFoundException('Trade no encontrado');
      if (trade.sellerUserId !== userId) {
        throw new ForbiddenException('Solo el vendedor confirma el pago recibido');
      }
      if (trade.status !== 'pending')
        throw new BadRequestException('El trade ya no está pendiente');

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
      if (trade.holdId) await this.ledger.setHoldStatus(manager, trade.holdId, 'committed');
      await this.ledger.postJournal(manager, trade.id, [
        { accountId: sellerAcc.id, direction: 'debit', amount: trade.amount, asset: trade.asset },
        { accountId: buyerAcc.id, direction: 'credit', amount: trade.amount, asset: trade.asset },
      ]);
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

  async myTrades(userId: string) {
    return this.trades.find({
      where: [{ buyerUserId: userId }, { sellerUserId: userId }],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}

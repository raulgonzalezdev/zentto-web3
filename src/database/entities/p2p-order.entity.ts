import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type P2pSide = 'buy' | 'sell';
export type P2pOrderStatus = 'open' | 'taken' | 'cancelled';

/**
 * Oferta P2P del order book: un usuario (maker) ofrece comprar o vender cripto
 * a un precio en fiat (VES). Las ofertas de VENTA escrowan el cripto del maker
 * (hold) para que no pueda gastarlo dos veces. v1: fill completo (single-fill).
 */
@Entity({ name: 'p2p_orders' })
export class P2pOrderEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  makerUserId!: string;

  @Column({ type: 'varchar', length: 8 })
  side!: P2pSide; // el maker compra (buy) o vende (sell) cripto

  @Column({ type: 'varchar', length: 16 })
  asset!: string; // USDT | USDC

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string; // cantidad de cripto

  @Column({ type: 'numeric', precision: 38, scale: 2 })
  priceVes!: string; // precio por unidad en VES

  @Column({ type: 'varchar', length: 64, nullable: true })
  paymentMethod!: string | null; // "Pago Móvil", "Transferencia", etc.

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'open' })
  status!: P2pOrderStatus;

  /** Hold que escrowa el cripto del maker (solo ofertas de venta). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  holdId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

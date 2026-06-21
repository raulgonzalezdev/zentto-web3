import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type P2pTradeStatus = 'pending' | 'completed' | 'cancelled';

/**
 * Trade P2P: alguien (taker) tomó una oferta. El cripto del VENDEDOR queda
 * escrowado; el comprador paga fiat off-platform; el vendedor confirma y el
 * cripto se libera al comprador (asiento en el ledger). Estilo Binance P2P.
 */
@Entity({ name: 'p2p_trades' })
export class P2pTradeEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  orderId!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  buyerUserId!: string; // recibe el cripto

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sellerUserId!: string; // entrega el cripto (su saldo está escrowado)

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Column({ type: 'numeric', precision: 38, scale: 2 })
  priceVes!: string;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status!: P2pTradeStatus;

  /** Hold que escrowa el cripto del vendedor para este trade. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  holdId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type P2pTradeStatus =
  | 'pending' // esperando que el comprador pague el fiat
  | 'paid' // comprador marcó pagado; esperando que el vendedor libere
  | 'completed' // vendedor liberó (o árbitro resolvió a favor del comprador)
  | 'cancelled' // cancelado / expiró sin pago (escrow reembolsado)
  | 'disputed' // en disputa: lo resuelve un árbitro (operador)
  | 'expired'; // venció una ventana de tiempo

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

  /** El comprador marcó el pago fiat. */
  @Column({ type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  /** Límite para que el comprador marque pagado (si no → auto-cancela). */
  @Column({ type: 'timestamptz', nullable: true })
  paymentDeadline!: Date | null;

  /** Límite para que el vendedor libere tras el pago (si no → a disputa). */
  @Column({ type: 'timestamptz', nullable: true })
  releaseDeadline!: Date | null;

  @Column({ type: 'text', nullable: true })
  disputeReason!: string | null;

  /** userId de quien abrió la disputa (comprador o vendedor). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  disputeBy!: string | null;

  /** userId del árbitro (operador) que resolvió. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  resolvedBy!: string | null;

  /** Resultado del árbitro: 'released' (al comprador) | 'refunded' (al vendedor). */
  @Column({ type: 'varchar', length: 12, nullable: true })
  resolution!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

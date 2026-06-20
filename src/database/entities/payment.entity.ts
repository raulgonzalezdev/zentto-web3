import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type PaymentType = 'credit' | 'transfer' | 'withdrawal' | 'deposit';
export type PaymentStatus =
  | 'created'
  | 'authorized'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'reversed';

/**
 * Pago = unidad de movimiento de dinero con ciclo de vida explícito e
 * idempotente. La `idempotencyKey` (única) garantiza que reintentos del cliente
 * o de la red NUNCA dupliquen ni dejen estados ambiguos.
 */
@Entity({ name: 'payments' })
@Unique(['userId', 'idempotencyKey'])
export class PaymentEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  // Idempotencia POR USUARIO (estilo Stripe): la misma key de dos usuarios
  // distintos es independiente; ver @Unique(['userId','idempotencyKey']).
  @Index()
  @Column({ type: 'varchar', length: 100 })
  idempotencyKey!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: PaymentType;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  status!: PaymentStatus;

  @Column({ type: 'varchar', length: 36, nullable: true })
  fromAccountId!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  toAccountId!: string | null;

  /** Contraparte legible (email destino, address on-chain, etc.). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  counterparty!: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

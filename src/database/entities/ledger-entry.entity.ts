import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Asiento contable inmutable. Cada movimiento de dinero genera ≥2 asientos que
 * SIEMPRE cuadran (suma de débitos == suma de créditos) → el ledger nunca se
 * descuadra por construcción. El saldo de una cuenta = Σ créditos − Σ débitos.
 */
@Entity({ name: 'ledger_entries' })
export class LedgerEntryEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  /** Pago/journal al que pertenece el asiento. */
  @Index()
  @Column({ type: 'varchar', length: 36 })
  paymentId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  accountId!: string;

  @Column({ type: 'varchar', length: 8 })
  direction!: 'debit' | 'credit';

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

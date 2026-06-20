import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type HoldStatus = 'active' | 'released' | 'committed';

/**
 * Retención (hold) de fondos para flujos en dos fases (ej. retiros on-chain):
 * el saldo disponible = saldo − holds activos. Al confirmar se `commit`; si
 * falla/expira se `release` (el usuario recupera el saldo automáticamente). Así
 * ninguna transacción colgada "come" saldo de forma permanente.
 */
@Entity({ name: 'holds' })
export class HoldEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  accountId!: string;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  paymentId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Index()
  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: HoldStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

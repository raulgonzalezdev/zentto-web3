import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

/**
 * Cuenta del ledger. Una por (propietario, asset). Los propietarios pueden ser
 * usuarios (`user`) o cuentas del sistema (`system`, ej. emisor/treasury/fees).
 * El saldo NO se guarda aquí: se calcula sumando los asientos (fuente de verdad).
 */
@Entity({ name: 'ledger_accounts' })
@Unique(['ownerType', 'ownerId', 'asset'])
export class LedgerAccountEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  ownerType!: 'user' | 'system';

  @Index()
  @Column({ type: 'varchar', length: 64 })
  ownerId!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

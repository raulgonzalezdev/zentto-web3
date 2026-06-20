import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

/**
 * Dirección de depósito asignada a un usuario (derivada del mnemónico maestro
 * por un índice HD único). El usuario envía cripto real a esta dirección; un
 * indexer (siguiente fase) detecta el depósito y acredita su saldo en el ledger.
 */
@Entity({ name: 'deposit_addresses' })
@Unique(['userId', 'network'])
@Unique(['network', 'derivationIndex'])
export class DepositAddressEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  network!: string; // 'evm'

  @Column({ type: 'varchar', length: 64 })
  address!: string;

  @Column({ type: 'int' })
  derivationIndex!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

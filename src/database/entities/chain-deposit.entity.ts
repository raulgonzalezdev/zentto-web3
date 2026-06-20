import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

/**
 * Depósito on-chain detectado y acreditado al ledger. La unicidad
 * (network, txHash, logIndex) garantiza que un mismo depósito NUNCA se acredite
 * dos veces (idempotencia frente a re-escaneos).
 */
@Entity({ name: 'chain_deposits' })
@Unique(['network', 'txHash', 'logIndex'])
export class ChainDepositEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  network!: string;

  @Index()
  @Column({ type: 'varchar', length: 66 })
  txHash!: string;

  @Column({ type: 'int' })
  logIndex!: number;

  @Column({ type: 'varchar', length: 64 })
  tokenAddress!: string;

  @Column({ type: 'varchar', length: 16 })
  asset!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  toAddress!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  @Column({ type: 'bigint' })
  blockNumber!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  paymentId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

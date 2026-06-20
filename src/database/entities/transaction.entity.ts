import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type TransactionStatus = 'pending' | 'mined';

/**
 * Transacción persistida. `fromAddress` nulo => transacción coinbase
 * (recompensa de minado, creada por el sistema, sin firma).
 */
@Entity({ name: 'transactions' })
export class TransactionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 130, nullable: true })
  fromAddress!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 130 })
  toAddress!: string;

  @Column({ type: 'double precision' })
  amount!: number;

  @Column({ type: 'double precision', default: 0 })
  fee!: number;

  @Column({ type: 'bigint' })
  timestamp!: string;

  @Column({ type: 'text', nullable: true })
  signature!: string | null;

  @Column({ type: 'varchar', length: 64 })
  hash!: string;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: TransactionStatus;

  @Index()
  @Column({ type: 'int', nullable: true })
  blockIndex!: number | null;
}

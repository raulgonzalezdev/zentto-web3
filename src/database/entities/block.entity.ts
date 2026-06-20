import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Bloque persistido. Las transacciones se relacionan por `blockIndex`
 * en TransactionEntity (no se embeben para poder consultarlas por separado).
 */
@Entity({ name: 'blocks' })
export class BlockEntity {
  @PrimaryColumn({ type: 'int' })
  index!: number;

  @Column({ type: 'bigint' })
  timestamp!: string;

  @Column({ type: 'varchar', length: 64 })
  previousHash!: string;

  @Column({ type: 'varchar', length: 64 })
  hash!: string;

  @Column({ type: 'varchar', length: 64 })
  merkleRoot!: string;

  @Column({ type: 'int' })
  nonce!: number;

  @Column({ type: 'int' })
  difficulty!: number;

  @Column({ type: 'varchar', length: 130, nullable: true })
  minerAddress!: string | null;
}

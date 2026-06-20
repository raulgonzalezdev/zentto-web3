import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Último bloque escaneado por el indexer, por red (para reanudar el escaneo). */
@Entity({ name: 'chain_cursors' })
export class ChainCursorEntity {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  network!: string;

  @Column({ type: 'bigint' })
  lastBlock!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

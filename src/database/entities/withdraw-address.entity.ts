import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

/**
 * Dirección de retiro guardada (favorita) por un usuario, estilo Meru: un alias
 * legible + la red + la address de destino, para retirar sin re-tipear y evitar
 * errores. Único por (userId, network, address).
 */
@Entity({ name: 'withdraw_addresses' })
@Unique(['userId', 'network', 'address'])
export class WithdrawAddressEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Column({ type: 'varchar', length: 64 })
  label!: string; // alias legible, p.ej. "Mi Binance"

  @Column({ type: 'varchar', length: 32 })
  network!: string; // key del catálogo: sepolia | polygon-amoy | bsc-testnet

  @Column({ type: 'varchar', length: 64 })
  address!: string; // address EVM de destino

  @Column({ type: 'varchar', length: 16, default: 'USDC' })
  asset!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

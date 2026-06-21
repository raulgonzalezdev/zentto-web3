import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Vínculo del usuario con su cuenta Binance (vía Binance Pay). Guarda su Binance
 * Pay ID o correo para enviarle payouts (retiros a Binance) por ID/correo, estilo
 * Meru. La autorización real ocurre en la app de Binance (no guardamos credenciales).
 */
@Entity({ name: 'binance_links' })
export class BinanceLinkEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  userId!: string;

  /** Binance Pay ID o correo del usuario (destino de los payouts). */
  @Column({ type: 'varchar', length: 128 })
  binanceAccount!: string;

  /** 'email' | 'pay_id' — cómo se identifica al destinatario en el payout. */
  @Column({ type: 'varchar', length: 12, default: 'email' })
  accountType!: string;

  @Column({ type: 'varchar', length: 12, default: 'linked' })
  status!: string; // linked | unlinked

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

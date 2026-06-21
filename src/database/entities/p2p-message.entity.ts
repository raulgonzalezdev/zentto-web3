import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Mensaje del chat de un trade P2P. Lo ven solo las partes (comprador/vendedor)
 * y el árbitro si el trade está en disputa. Puede llevar una evidencia de pago
 * adjunta (imagen en data URL base64 — suficiente para el caso de uso actual).
 */
@Entity({ name: 'p2p_messages' })
export class P2pMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  tradeId!: string;

  /** userId del autor, o 'system' para mensajes automáticos del escrow. */
  @Column({ type: 'varchar', length: 64 })
  senderUserId!: string;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  /** Evidencia de pago adjunta (data URL base64, p.ej. captura del Pago Móvil). */
  @Column({ type: 'text', nullable: true })
  attachment!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

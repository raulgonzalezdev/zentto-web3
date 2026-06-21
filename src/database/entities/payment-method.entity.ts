import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type PaymentMethodType = 'pago_movil' | 'bank_account';

/**
 * Dato de cobro del usuario (Pago Móvil / cuenta bancaria) guardado en su perfil.
 * Se adjunta a las ofertas P2P para que la contraparte copie los datos sin errores.
 */
@Entity({ name: 'payment_methods' })
export class PaymentMethodEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: PaymentMethodType;

  @Column({ type: 'varchar', length: 80 })
  label!: string; // "Mi Pago Móvil", "Banco de Venezuela", etc.

  @Column({ type: 'varchar', length: 120, nullable: true })
  bankName!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  accountHolder!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  idNumber!: string | null; // cédula/RIF

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null; // pago móvil

  @Column({ type: 'varchar', length: 40, nullable: true })
  accountNumber!: string | null; // nro de cuenta

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

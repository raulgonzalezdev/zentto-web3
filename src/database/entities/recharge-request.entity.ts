import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type RechargeStatus =
  | 'pending' // creada por el usuario; en cola para que un operador la tome
  | 'claimed' // un operador la reclamó y compartió sus datos de pago
  | 'paid' // el usuario marcó el fiat pagado y subió evidencia
  | 'completed' // el operador acreditó el cripto al usuario (con comisión)
  | 'cancelled' // cancelada por el usuario (antes de completar)
  | 'expired'; // venció una ventana de tiempo

/**
 * Solicitud de recarga formal (modelo tipo AirTM): el usuario paga en bolívares a
 * un operador verificado vía pago móvil, y el operador entrega el cripto (USDC)
 * acreditándolo en el ledger. Cada solicitud recorre pending→claimed→paid→completed.
 */
@Entity('recharge_requests')
export class RechargeRequestEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  /** Usuario que solicita la recarga (recibe el cripto). */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  /** Operador que reclamó y procesa la solicitud (entrega el cripto). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  operatorUserId!: string | null;

  /** Método de pago fiat acordado. */
  @Column({ type: 'varchar', length: 16, default: 'pago_movil' })
  method!: string;

  @Column({ type: 'varchar', length: 16, default: 'USDC' })
  asset!: string;

  /** Cripto a recibir el usuario (bruto, antes de comisión). */
  @Column({ type: 'numeric', precision: 38, scale: 18 })
  amount!: string;

  /** Tasa Bs/USDC pactada al crear la solicitud. */
  @Column({ type: 'numeric', precision: 38, scale: 2 })
  rateVes!: string;

  /** Bolívares a pagar = amount * rateVes. */
  @Column({ type: 'numeric', precision: 38, scale: 2 })
  fiatAmount!: string;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status!: RechargeStatus;

  /** Datos de pago del operador, se muestran al usuario al reclamar (pending→claimed). */
  @Column({ type: 'text', nullable: true })
  operatorPaymentInfo!: string | null;

  /** Comprobante del usuario como data URL de imagen (claimed→paid). */
  @Column({ type: 'text', nullable: true })
  evidence!: string | null;

  /** Comisión de plataforma cobrada al acreditar (transparencia). */
  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  feeAmount!: string;

  /** El operador reclamó la solicitud. */
  @Column({ type: 'timestamptz', nullable: true })
  claimedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

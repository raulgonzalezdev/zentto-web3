import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type AccountTokenType = 'verify_email' | 'reset_password';

/**
 * Token de un solo uso para flujos sensibles de cuenta (verificación de email,
 * recuperación de contraseña).
 *
 * Seguridad: en BD solo se persiste el **hash sha256** del token (`tokenHash`).
 * El valor plano se envía por email y nunca se almacena, igual que una
 * contraseña. Un token es válido si: existe el hash, `usedAt` es null y
 * `expiresAt` está en el futuro.
 */
@Entity({ name: 'account_tokens' })
export class AccountTokenEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: AccountTokenType;

  /** sha256(hex) del token plano. Indexado para lookup directo en la validación. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** Marca el momento en que se consumió. Null mientras siga vigente. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

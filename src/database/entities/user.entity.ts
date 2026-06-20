import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Usuario de la plataforma. Las contraseñas se guardan hasheadas (bcrypt) y el
 * secreto TOTP solo se persiste cuando el usuario activa el 2FA.
 *
 * `tokenVersion` permite invalidar todos los refresh tokens emitidos (logout
 * global / revocación) incrementándolo: cualquier refresh con versión anterior
 * se rechaza.
 */
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  displayName!: string | null;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** Secreto TOTP (base32). Presente cuando hay 2FA configurado o pendiente. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  totpSecret!: string | null;

  /** True solo cuando el usuario completó la activación del 2FA. */
  @Column({ type: 'boolean', default: false })
  totpEnabled!: boolean;

  @Column({ type: 'int', default: 0 })
  tokenVersion!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

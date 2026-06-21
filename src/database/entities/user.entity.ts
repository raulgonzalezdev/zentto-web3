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

  /** Teléfono (para buscar/recibir en transferencias P2P). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  /** Rol: 'user' (cliente del neobanco) | 'operator' | 'admin' (backoffice). */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  role!: 'user' | 'operator' | 'admin';

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** Secreto TOTP (base32). Presente cuando hay 2FA configurado o pendiente. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  totpSecret!: string | null;

  /** True solo cuando el usuario completó la activación del 2FA. */
  @Column({ type: 'boolean', default: false })
  totpEnabled!: boolean;

  /**
   * True solo tras confirmar el email vía token. Informativo en v1 (NO bloquea el
   * login), pero desbloquea acciones sensibles y se expone en /auth/me.
   */
  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column({ type: 'int', default: 0 })
  tokenVersion!: number;

  /** Última vez que la contraseña cambió (reset). Null = nunca cambió tras el registro. */
  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt!: Date | null;

  /** Intentos de login fallidos consecutivos. Se resetea al loguear con éxito. */
  @Column({ type: 'int', default: 0 })
  failedLoginCount!: number;

  /** Si está en el futuro, la cuenta está bloqueada por exceso de intentos. */
  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

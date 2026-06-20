import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type KycStatus =
  | 'not_started'
  | 'pending' // enviado, esperando al proveedor de liveness
  | 'in_review' // requiere revisión manual del operador
  | 'approved'
  | 'rejected'
  | 'needs_more_info';

/**
 * Verificación KYC de un usuario. Orquestación PROPIA: guarda los datos, el
 * resultado de MRZ y AML (in-house) y el estado del proveedor de liveness
 * (Didit u otro, vía adaptador). Una verificación activa por usuario.
 */
@Entity({ name: 'kyc_verifications' })
@Unique(['userId'])
export class KycVerificationEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  userId!: string;

  @Column({ type: 'varchar', length: 24, default: 'not_started' })
  status!: KycStatus;

  @Column({ type: 'varchar', length: 160, nullable: true })
  fullName!: string | null;

  // Acepta YYMMDD (MRZ) o YYYY-MM-DD (Didit id-verification).
  @Column({ type: 'varchar', length: 16, nullable: true })
  birthDate!: string | null;

  // Didit devuelve código o nombre de país; MRZ devuelve 3 letras.
  @Column({ type: 'varchar', length: 64, nullable: true })
  nationality!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  documentType!: string | null; // passport | id_card | PASSPORT | DRIVING_LICENSE…

  @Column({ type: 'varchar', length: 64, nullable: true })
  documentNumber!: string | null;

  @Column({ type: 'boolean', default: false })
  mrzValid!: boolean;

  @Column({ type: 'boolean', default: false })
  amlMatch!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  amlHits!: unknown;

  @Column({ type: 'varchar', length: 24, default: 'manual' })
  provider!: string; // manual | didit

  @Column({ type: 'varchar', length: 128, nullable: true })
  providerRef!: string | null; // id de sesión del proveedor

  @Column({ type: 'boolean', nullable: true })
  livenessPassed!: boolean | null;

  @Column({ type: 'text', nullable: true })
  decisionReason!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reviewedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

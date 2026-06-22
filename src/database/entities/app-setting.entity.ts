import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Parámetros configurables en runtime desde el backoffice (fees, límites, etc.).
 * Key-value; el SettingsService los superpone sobre los defaults del `.env`.
 */
@Entity('app_settings')
export class AppSettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

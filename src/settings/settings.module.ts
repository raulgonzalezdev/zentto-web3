import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSettingEntity } from '../database/entities/app-setting.entity';
import { SettingsService } from './settings.service';

/**
 * Configuración runtime editable desde el backoffice. Global para que cualquier
 * servicio (fees, sweep, …) pueda inyectar SettingsService sin re-importar.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppSettingEntity])],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

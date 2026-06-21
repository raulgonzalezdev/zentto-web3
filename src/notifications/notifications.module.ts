import { Module } from '@nestjs/common';
import { NotifyService } from './notify.service';

/**
 * Módulo de notificaciones (emails transaccionales vía zentto-notify).
 * Exporta NotifyService para que auth (y otros) envíen correos.
 */
@Module({
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotificationsModule {}

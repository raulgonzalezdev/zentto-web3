import { Module } from '@nestjs/common';
import { FeesController } from './fees.controller';
import { FeeService } from './fee.service';

/** Provee el cálculo de comisiones de plataforma a todos los módulos que mueven dinero. */
@Module({
  controllers: [FeesController],
  providers: [FeeService],
  exports: [FeeService],
})
export class FeesModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { AmlScreeningService } from './aml-screening.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { MrzService } from './mrz.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycVerificationEntity])],
  controllers: [KycController],
  providers: [KycService, MrzService, AmlScreeningService],
  exports: [KycService],
})
export class KycModule {}

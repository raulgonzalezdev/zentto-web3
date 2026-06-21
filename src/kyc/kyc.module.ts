import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { AmlScreeningService } from './aml-screening.service';
import { DiditWebhookController } from './didit-webhook.controller';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { MrzService } from './mrz.service';
import { DiditApiService } from './providers/didit-api.service';
import { ZenttoKycApiService } from './providers/zentto-kyc-api.service';

@Module({
  imports: [TypeOrmModule.forFeature([KycVerificationEntity]), JwtModule.register({})],
  controllers: [KycController, DiditWebhookController],
  providers: [KycService, MrzService, AmlScreeningService, DiditApiService, ZenttoKycApiService],
  exports: [KycService],
})
export class KycModule {}

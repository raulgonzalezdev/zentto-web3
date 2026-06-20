import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { UserEntity } from '../database/entities/user.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OperatorGuard } from './operator.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, KycVerificationEntity, PaymentEntity]),
    LedgerModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, OperatorGuard],
})
export class AdminModule {}

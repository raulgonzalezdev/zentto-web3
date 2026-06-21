import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { UserEntity } from '../database/entities/user.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { P2pMarketModule } from '../marketplace/p2p-market.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OperatorGuard } from './operator.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, KycVerificationEntity, PaymentEntity]),
    LedgerModule,
    P2pMarketModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, OperatorGuard],
})
export class AdminModule {}

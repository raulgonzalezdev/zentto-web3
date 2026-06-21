import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { RechargeRequestEntity } from '../database/entities/recharge-request.entity';
import { UserEntity } from '../database/entities/user.entity';
import { CustodyModule } from '../custody/custody.module';
import { EvmModule } from '../evm/evm.module';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { P2pMarketModule } from '../marketplace/p2p-market.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OperatorGuard } from './operator.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      KycVerificationEntity,
      PaymentEntity,
      RechargeRequestEntity,
    ]),
    LedgerModule,
    P2pMarketModule,
    CustodyModule,
    EvmModule,
    FeesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, OperatorGuard],
})
export class AdminModule {}

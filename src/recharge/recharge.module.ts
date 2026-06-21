import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperatorGuard } from '../admin/operator.guard';
import { AuthModule } from '../auth/auth.module';
import { RechargeRequestEntity } from '../database/entities/recharge-request.entity';
import { UserEntity } from '../database/entities/user.entity';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OperatorRechargeController } from './operator-recharge.controller';
import { RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RechargeRequestEntity, UserEntity]),
    LedgerModule,
    FeesModule,
    AuthModule,
  ],
  controllers: [RechargeController, OperatorRechargeController],
  providers: [RechargeService, OperatorGuard],
})
export class RechargeModule {}

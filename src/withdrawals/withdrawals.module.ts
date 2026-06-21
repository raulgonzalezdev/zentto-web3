import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PaymentEntity } from '../database/entities/payment.entity';
import { WithdrawAddressEntity } from '../database/entities/withdraw-address.entity';
import { CustodyModule } from '../custody/custody.module';
import { EvmModule } from '../evm/evm.module';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentEntity, WithdrawAddressEntity]),
    AuthModule,
    LedgerModule,
    CustodyModule,
    EvmModule,
    FeesModule,
  ],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
})
export class WithdrawalsModule {}

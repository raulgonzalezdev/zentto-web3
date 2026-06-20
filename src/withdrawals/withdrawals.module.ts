import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentEntity } from '../database/entities/payment.entity';
import { CustodyModule } from '../custody/custody.module';
import { EvmModule } from '../evm/evm.module';
import { LedgerModule } from '../ledger/ledger.module';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity]), LedgerModule, CustodyModule, EvmModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
})
export class WithdrawalsModule {}

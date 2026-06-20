import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChainCursorEntity } from '../database/entities/chain-cursor.entity';
import { ChainDepositEntity } from '../database/entities/chain-deposit.entity';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { EvmModule } from '../evm/evm.module';
import { LedgerModule } from '../ledger/ledger.module';
import { DepositIndexerService } from './deposit-indexer.service';
import { IndexerController } from './indexer.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DepositAddressEntity,
      ChainCursorEntity,
      ChainDepositEntity,
      PaymentEntity,
    ]),
    EvmModule,
    LedgerModule,
  ],
  controllers: [IndexerController],
  providers: [DepositIndexerService],
})
export class IndexerModule {}

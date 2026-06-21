import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChainCursorEntity } from '../database/entities/chain-cursor.entity';
import { ChainDepositEntity } from '../database/entities/chain-deposit.entity';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { EvmModule } from '../evm/evm.module';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TronService } from '../custody/tron.service';
import { SolanaService } from '../custody/solana.service';
import { AlchemyWebhookController } from './alchemy-webhook.controller';
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
    FeesModule,
  ],
  controllers: [IndexerController, AlchemyWebhookController],
  providers: [DepositIndexerService, TronService, SolanaService],
})
export class IndexerModule {}

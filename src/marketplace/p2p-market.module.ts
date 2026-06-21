import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { P2pMessageEntity } from '../database/entities/p2p-message.entity';
import { P2pOrderEntity } from '../database/entities/p2p-order.entity';
import { P2pTradeEntity } from '../database/entities/p2p-trade.entity';
import { UserEntity } from '../database/entities/user.entity';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { P2pMarketController } from './p2p-market.controller';
import { P2pMarketService } from './p2p-market.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([P2pOrderEntity, P2pTradeEntity, P2pMessageEntity, UserEntity]),
    LedgerModule,
    AuthModule,
    FeesModule,
  ],
  controllers: [P2pMarketController],
  providers: [P2pMarketService],
  exports: [P2pMarketService],
})
export class P2pMarketModule {}

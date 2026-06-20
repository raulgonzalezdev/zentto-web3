import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AnalyticsController } from './analytics.controller';
import { CrossChainService } from './cross-chain.service';

@Module({
  imports: [BlockchainModule],
  controllers: [AnalyticsController],
  providers: [CrossChainService],
})
export class AnalyticsModule {}

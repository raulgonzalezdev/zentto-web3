import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [BlockchainModule],
  controllers: [WalletsController],
  providers: [WalletsService],
})
export class WalletsModule {}

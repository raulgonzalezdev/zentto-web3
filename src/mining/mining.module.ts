import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { MINING_QUEUE } from './mining.constants';
import { MiningController } from './mining.controller';
import { MiningProcessor } from './mining.processor';
import { MiningService } from './mining.service';

@Module({
  imports: [BlockchainModule, BullModule.registerQueue({ name: MINING_QUEUE })],
  controllers: [MiningController],
  providers: [MiningService, MiningProcessor],
  exports: [MiningService],
})
export class MiningModule {}

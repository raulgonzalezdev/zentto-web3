import { Module } from '@nestjs/common';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { P2pController } from './p2p.controller';
import { P2pService } from './p2p.service';

@Module({
  imports: [BlockchainModule],
  controllers: [P2pController],
  providers: [P2pService],
})
export class P2pModule {}

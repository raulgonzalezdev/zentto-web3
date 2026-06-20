import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlockEntity } from '../database/entities/block.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './blockchain.service';
import { TransactionsController } from './transactions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BlockEntity, TransactionEntity])],
  controllers: [BlockchainController, TransactionsController],
  providers: [BlockchainService],
  exports: [BlockchainService, TypeOrmModule],
})
export class BlockchainModule {}

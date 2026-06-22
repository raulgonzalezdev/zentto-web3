import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { AlchemyNotifyService } from './alchemy-notify.service';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';
import { SolanaService } from './solana.service';
import { StellarService } from './stellar.service';
import { SweepService } from './sweep.service';
import { TronService } from './tron.service';

@Module({
  imports: [TypeOrmModule.forFeature([DepositAddressEntity])],
  controllers: [CustodyController],
  providers: [
    CustodyService,
    TronService,
    StellarService,
    SolanaService,
    SweepService,
    AlchemyNotifyService,
  ],
  exports: [CustodyService, TronService, StellarService, SolanaService, SweepService],
})
export class CustodyModule {}

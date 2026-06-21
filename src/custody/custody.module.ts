import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';
import { StellarService } from './stellar.service';
import { TronService } from './tron.service';

@Module({
  imports: [TypeOrmModule.forFeature([DepositAddressEntity])],
  controllers: [CustodyController],
  providers: [CustodyService, TronService, StellarService],
  exports: [CustodyService, TronService, StellarService],
})
export class CustodyModule {}

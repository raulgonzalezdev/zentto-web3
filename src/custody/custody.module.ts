import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';

@Module({
  imports: [TypeOrmModule.forFeature([DepositAddressEntity])],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HoldEntity } from '../database/entities/hold.entity';
import { LedgerAccountEntity } from '../database/entities/ledger-account.entity';
import { LedgerEntryEntity } from '../database/entities/ledger-entry.entity';
import { LedgerService } from './ledger.service';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerAccountEntity, LedgerEntryEntity, HoldEntity])],
  providers: [LedgerService],
  exports: [LedgerService, TypeOrmModule],
})
export class LedgerModule {}

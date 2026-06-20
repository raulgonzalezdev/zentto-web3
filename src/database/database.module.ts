import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseConfig } from '../config/configuration';
import { BlockEntity } from './entities/block.entity';
import { ChainCursorEntity } from './entities/chain-cursor.entity';
import { ChainDepositEntity } from './entities/chain-deposit.entity';
import { DepositAddressEntity } from './entities/deposit-address.entity';
import { HoldEntity } from './entities/hold.entity';
import { KycVerificationEntity } from './entities/kyc-verification.entity';
import { LedgerAccountEntity } from './entities/ledger-account.entity';
import { LedgerEntryEntity } from './entities/ledger-entry.entity';
import { PaymentEntity } from './entities/payment.entity';
import { TransactionEntity } from './entities/transaction.entity';
import { UserEntity } from './entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.getOrThrow<DatabaseConfig>('database');
        return {
          type: 'postgres' as const,
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
          entities: [
            BlockEntity,
            TransactionEntity,
            UserEntity,
            LedgerAccountEntity,
            LedgerEntryEntity,
            PaymentEntity,
            HoldEntity,
            DepositAddressEntity,
            ChainCursorEntity,
            ChainDepositEntity,
            KycVerificationEntity,
          ],
          synchronize: db.synchronize,
          logging: db.logging,
          // Reintentos al arrancar: la BD del contenedor puede tardar en estar lista.
          retryAttempts: 10,
          retryDelay: 3000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}

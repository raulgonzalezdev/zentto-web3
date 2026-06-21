import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BinanceLinkEntity } from '../database/entities/binance-link.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { FeesModule } from '../fees/fees.module';
import { LedgerModule } from '../ledger/ledger.module';
import { BinanceController, BinanceWebhookController } from './binance.controller';
import { BinancePayService } from './binance-pay.service';
import { BinanceService } from './binance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BinanceLinkEntity, PaymentEntity]),
    LedgerModule,
    FeesModule,
    AuthModule,
  ],
  controllers: [BinanceController, BinanceWebhookController],
  providers: [BinanceService, BinancePayService],
})
export class BinanceModule {}

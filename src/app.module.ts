import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CsrfGuard } from './auth/guards/csrf.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CsrfCookieMiddleware } from './auth/middleware/csrf-cookie.middleware';
import { BlockchainModule } from './blockchain/blockchain.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ComplianceModule } from './compliance/compliance.module';
import configuration, { RedisConfig } from './config/configuration';
import { CustodyModule } from './custody/custody.module';
import { EvmModule } from './evm/evm.module';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IndexerModule } from './indexer/indexer.module';
import { KycModule } from './kyc/kyc.module';
import { P2pMarketModule } from './marketplace/p2p-market.module';
import { MiningModule } from './mining/mining.module';
import { PaymentMethodsModule } from './payment-methods/payment-methods.module';
import { PaymentsModule } from './payments/payments.module';
import { BinanceModule } from './binance/binance.module';
import { P2pModule } from './p2p/p2p.module';
import { RechargeModule } from './recharge/recharge.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { WithdrawalsModule } from './withdrawals/withdrawals.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.getOrThrow<RedisConfig>('redis');
        return { connection: { host: redis.host, port: redis.port } };
      },
    }),
    AuthModule,
    BlockchainModule,
    WalletsModule,
    MiningModule,
    ComplianceModule,
    AnalyticsModule,
    P2pModule,
    BinanceModule,
    EvmModule,
    PaymentsModule,
    CustodyModule,
    IndexerModule,
    WithdrawalsModule,
    KycModule,
    AdminModule,
    P2pMarketModule,
    PaymentMethodsModule,
    UsersModule,
    HealthModule,
    RechargeModule,
    SettingsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    // Orden: primero autenticación (JWT en cookie), luego CSRF en mutaciones.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfCookieMiddleware).forRoutes('*');
  }
}

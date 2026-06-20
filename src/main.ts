import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(cookieParser());
  // CORS con credenciales (cookies). Con credenciales no se permite '*':
  // se refleja el/los origen(es) configurados (lista separada por comas).
  const corsOrigin =
    appCfg.corsOrigin === '*' ? true : appCfg.corsOrigin.split(',').map((o) => o.trim());
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    exposedHeaders: ['X-CSRF-Token'],
  });
  app.setGlobalPrefix(appCfg.apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();

  // Documentación OpenAPI / Swagger en /{prefix}/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Zentto Web3 API')
    .setDescription(
      'Backend Web3 independiente: blockchain básica (Proof of Work), wallets, ' +
        'pipeline asíncrono de minado, screening AML y generación de informes de ' +
        'cumplimiento con IA.',
    )
    .setVersion('1.0.0')
    .addTag('blockchain')
    .addTag('wallets')
    .addTag('transactions')
    .addTag('mining')
    .addTag('compliance')
    .addTag('analytics')
    .addTag('health')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${appCfg.apiPrefix}/docs`, app, document);

  await app.listen(appCfg.port, '0.0.0.0');
  logger.log(
    `🚀 Zentto Web3 API escuchando en http://localhost:${appCfg.port}/${appCfg.apiPrefix}`,
  );
  logger.log(`📚 Swagger en http://localhost:${appCfg.port}/${appCfg.apiPrefix}/docs`);
}

bootstrap();

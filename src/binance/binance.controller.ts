import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { BinanceService } from './binance.service';
import { BinancePayService } from './binance-pay.service';

const DECIMAL = /^\d+(\.\d+)?$/;

class LinkBinanceDto {
  @ApiProperty({ example: 'usuario@correo.com' })
  @IsString()
  account!: string;

  @ApiProperty({ enum: ['email', 'pay_id'] })
  @IsIn(['email', 'pay_id'])
  accountType!: 'email' | 'pay_id';
}

class BinanceAmountDto {
  @ApiProperty({ example: '50' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount debe ser un decimal positivo' })
  amount!: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode debe ser de 6 dígitos' })
  totpCode?: string;
}

@ApiTags('binance')
@Controller('binance')
export class BinanceController {
  constructor(
    private readonly binance: BinanceService,
    private readonly pay: BinancePayService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado del vínculo Binance del usuario' })
  status(@CurrentUser() user: AuthUser) {
    return this.binance.status(user.sub);
  }

  @Post('link')
  @ApiOperation({ summary: 'Vincular cuenta Binance (Binance Pay ID o correo)' })
  link(@CurrentUser() user: AuthUser, @Body() dto: LinkBinanceDto) {
    return this.binance.link(user.sub, dto.account, dto.accountType);
  }

  @Post('recharge')
  @ApiOperation({ summary: 'Recargar desde Binance (orden Binance Pay → checkout)' })
  recharge(@CurrentUser() user: AuthUser, @Body() dto: BinanceAmountDto) {
    return this.binance.recharge(user.sub, dto.amount);
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Retirar a Binance por payout (ID/correo vinculado) — 2FA' })
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: BinanceAmountDto) {
    return this.binance.withdraw(user.sub, dto.amount, dto.totpCode);
  }
}

/** Webhook server-to-server de Binance Pay (sin auth: se valida por firma HMAC). */
@ApiTags('webhooks')
@Controller('webhook')
export class BinanceWebhookController {
  constructor(
    private readonly binance: BinanceService,
    private readonly pay: BinancePayService,
  ) {}

  @Public()
  @Post('binance')
  @ApiOperation({ summary: 'Webhook de Binance Pay: confirma recargas (firma HMAC)' })
  async binanceWebhook(@Req() req: RawBodyRequest<Request>, @Body() body: Record<string, unknown>) {
    const ok = this.pay.verifyWebhook(
      req.headers as Record<string, unknown>,
      req.rawBody ?? Buffer.from(''),
    );
    if (!ok) return { ok: false };
    // Binance Pay envía bizType PAY + bizStatus PAY_SUCCESS con el merchantTradeNo en data.
    const bizStatus = String(body?.bizStatus ?? '');
    const data =
      typeof body?.data === 'string' ? safeParse(body.data as string) : (body?.data ?? {});
    const merchantTradeNo = String((data as { merchantTradeNo?: string })?.merchantTradeNo ?? '');
    if (bizStatus === 'PAY_SUCCESS' && merchantTradeNo) {
      await this.binance.handlePaidWebhook(merchantTradeNo);
    }
    return { returnCode: 'SUCCESS', returnMessage: null };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

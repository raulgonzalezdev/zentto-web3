import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { KycService } from './kyc.service';

/**
 * Alias del webhook de Didit en `/webhook/didit` (excluido del prefijo /api en
 * main.ts), para coincidir con la URL registrada en el dashboard de Didit.
 * Mismo handler que `/api/kyc/webhook/didit`: valida la firma HMAC.
 */
@ApiExcludeController()
@Controller('webhook')
export class DiditWebhookController {
  constructor(private readonly kyc: KycService) {}

  @Public()
  @Post('didit')
  didit(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.kyc.handleDiditWebhook(body, req.headers);
  }
}

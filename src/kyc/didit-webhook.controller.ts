import { Body, Controller, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { KycService } from './kyc.service';

/**
 * Aliases de webhooks KYC sin el prefijo /api (excluidos en main.ts), para
 * coincidir con las URLs registradas en los dashboards:
 *   - `/webhook/didit` → Didit (firma HMAC en campos del body).
 *   - `/webhook/kyc`   → zentto-kyc nativo (firma HMAC sobre el body crudo).
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

  @Public()
  @Post('kyc')
  zentto(@Req() req: RawBodyRequest<Request>) {
    return this.kyc.handleZenttoWebhook(req.rawBody ?? Buffer.from(''), req.headers);
  }
}

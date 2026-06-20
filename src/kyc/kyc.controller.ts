import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { KycDecisionDto, KycSubmitDto } from './dto/kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado KYC del usuario' })
  status(@CurrentUser() user: AuthUser) {
    return this.kyc.getStatus(user.sub);
  }

  @Post('submit')
  @ApiOperation({ summary: 'Envía datos + documento (MRZ) para verificación' })
  submit(@CurrentUser() user: AuthUser, @Body() dto: KycSubmitDto) {
    return this.kyc.submit(user.sub, dto);
  }

  // Webhook server-to-server de Didit (sin auth/CSRF: se valida por firma HMAC).
  @Public()
  @Post('webhook/didit')
  @ApiOperation({ summary: 'Webhook de Didit con el resultado de la verificación' })
  diditWebhook(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.kyc.handleDiditWebhook(body, req.headers);
  }

  // ⚠️ OPERADOR (backoffice): cola de revisión. Pendiente de role-gating real.
  @Get('pending')
  @ApiOperation({ summary: 'Operador: verificaciones en cola de revisión' })
  pending() {
    return this.kyc.listPending();
  }

  // ⚠️ Endpoint de OPERADOR (backoffice). Pendiente de role-gating real
  // (hoy cualquier usuario autenticado; en prod restringir a rol operator).
  @Post(':id/decision')
  @ApiOperation({ summary: 'Operador: aprueba o rechaza una verificación en revisión' })
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: KycDecisionDto) {
    return this.kyc.decide(id, dto.approve, user.sub, dto.reason);
  }
}

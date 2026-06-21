import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateRechargeDto, SubmitEvidenceDto } from './dto/recharge.dto';
import { RechargeService } from './recharge.service';

@ApiTags('recharge')
@Controller()
export class RechargeController {
  constructor(private readonly recharge: RechargeService) {}

  @Post('recharge/requests')
  @ApiOperation({ summary: 'Crear una solicitud de recarga (pago móvil → cripto)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRechargeDto) {
    return this.recharge.createRequest(user.sub, { amount: dto.amount, rateVes: dto.rateVes });
  }

  @Get('recharge/requests')
  @ApiOperation({ summary: 'Mis solicitudes de recarga' })
  mine(@CurrentUser() user: AuthUser) {
    return this.recharge.myRequests(user.sub);
  }

  @Post('recharge/requests/:id/evidence')
  @ApiOperation({ summary: 'Subir comprobante del pago fiat (claimed→paid)' })
  evidence(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubmitEvidenceDto) {
    return this.recharge.submitEvidence(user.sub, id, dto.attachment);
  }

  @Post('recharge/requests/:id/cancel')
  @ApiOperation({ summary: 'Cancelar mi solicitud (pending|claimed)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recharge.cancel(user.sub, id);
  }
}

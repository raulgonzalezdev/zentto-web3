import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OperatorGuard } from '../admin/operator.guard';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ClaimRechargeDto, ConfirmRechargeDto } from './dto/recharge.dto';
import { RechargeService } from './recharge.service';

@ApiTags('recharge-operator')
@UseGuards(OperatorGuard)
@Controller('operator')
export class OperatorRechargeController {
  constructor(private readonly recharge: RechargeService) {}

  @Get('recharge/requests')
  @ApiOperation({ summary: 'Cola abierta de solicitudes de recarga (pendientes)' })
  open() {
    return this.recharge.listOpen();
  }

  @Post('recharge/requests/:id/claim')
  @ApiOperation({ summary: 'Reclamar una solicitud y compartir datos de pago' })
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ClaimRechargeDto) {
    return this.recharge.claim(user.sub, id, dto.operatorPaymentInfo);
  }

  @Post('recharge/requests/:id/confirm')
  @ApiOperation({ summary: 'Confirmar el pago recibido y acreditar el cripto (2FA)' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ConfirmRechargeDto) {
    return this.recharge.confirm(user.sub, id, dto.totpCode);
  }
}

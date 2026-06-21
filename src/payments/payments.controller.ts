import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreditDto, TransferDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('accounts/balance')
  @ApiOperation({ summary: 'Saldos del usuario por asset (saldo, retenido, disponible)' })
  balances(@CurrentUser() user: AuthUser) {
    return this.payments.getBalances(user.sub);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Historial de pagos del usuario' })
  list(@CurrentUser() user: AuthUser) {
    return this.payments.listPayments(user.sub);
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Detalle de un pago' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.getPayment(user.sub, id);
  }

  @Post('payments/transfer')
  @ApiOperation({ summary: 'Transferencia interna instantánea (idempotente)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  transfer(
    @CurrentUser() user: AuthUser,
    @Body() dto: TransferDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.payments.transfer(
      user.sub,
      dto.toEmail,
      dto.asset,
      dto.amount,
      key || randomUUID(),
      dto.totpCode,
    );
  }

  @Post('payments/credit')
  @ApiOperation({ summary: 'Faucet de desarrollo: acreditar saldo de prueba (idempotente)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  credit(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreditDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.payments.credit(user.sub, dto.asset, dto.amount, key || randomUUID());
  }
}

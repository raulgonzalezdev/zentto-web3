import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { WithdrawDto } from './dto/withdraw.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@Controller()
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Post('payments/withdraw')
  @ApiOperation({ summary: 'Retiro on-chain: coloca hold y emite (idempotente)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  withdraw(
    @CurrentUser() user: AuthUser,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.withdrawals.request({
      userId: user.sub,
      asset: dto.asset,
      amount: dto.amount,
      toAddress: dto.toAddress,
      idempotencyKey: key || randomUUID(),
    });
  }

  @Post('payments/withdrawals/process')
  @ApiOperation({ summary: 'Dispara un ciclo de broadcast + reconciliación (manual/dev)' })
  process() {
    return this.withdrawals.runCycle();
  }
}

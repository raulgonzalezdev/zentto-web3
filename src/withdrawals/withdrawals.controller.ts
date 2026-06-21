import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { SaveWithdrawAddressDto, WithdrawDto } from './dto/withdraw.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@Controller()
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get('me/withdraw-addresses')
  @ApiOperation({ summary: 'Mis direcciones de retiro guardadas (favoritas)' })
  listFavorites(@CurrentUser() user: AuthUser) {
    return this.withdrawals.listFavorites(user.sub);
  }

  @Post('me/withdraw-addresses')
  @ApiOperation({ summary: 'Guardar una dirección de retiro favorita' })
  addFavorite(@CurrentUser() user: AuthUser, @Body() dto: SaveWithdrawAddressDto) {
    return this.withdrawals.addFavorite(user.sub, dto);
  }

  @Delete('me/withdraw-addresses/:id')
  @ApiOperation({ summary: 'Eliminar una dirección de retiro favorita' })
  removeFavorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.withdrawals.removeFavorite(user.sub, id);
  }

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
      network: dto.network,
      saveLabel: dto.saveLabel,
      idempotencyKey: key || randomUUID(),
      totpCode: dto.totpCode,
    });
  }

  @Post('payments/withdrawals/process')
  @ApiOperation({ summary: 'Dispara un ciclo de broadcast + reconciliación (manual/dev)' })
  process() {
    return this.withdrawals.runCycle();
  }
}

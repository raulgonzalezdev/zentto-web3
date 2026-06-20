import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CustodyService } from './custody.service';

@ApiTags('custody')
@Controller('accounts')
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @Get('deposit-address')
  @ApiOperation({ summary: 'Dirección de depósito on-chain del usuario (testnet)' })
  depositAddress(@CurrentUser() user: AuthUser) {
    return this.custody.depositInfo(user.sub);
  }
}

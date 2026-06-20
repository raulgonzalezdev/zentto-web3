import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { DepositIndexerService } from './deposit-indexer.service';

@ApiTags('deposits')
@Controller('accounts/deposits')
export class IndexerController {
  constructor(private readonly indexer: DepositIndexerService) {}

  @Get()
  @ApiOperation({ summary: 'Depósitos on-chain detectados del usuario' })
  list(@CurrentUser() user: AuthUser) {
    return this.indexer.listUserDeposits(user.sub);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Dispara un ciclo de escaneo de depósitos (manual)' })
  sync() {
    return this.indexer.scan();
  }
}

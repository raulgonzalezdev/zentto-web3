import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { NetworksConfig } from '../config/configuration';
import { CustodyService } from './custody.service';

@ApiTags('custody')
@Controller()
export class CustodyController {
  constructor(
    private readonly custody: CustodyService,
    private readonly config: ConfigService,
  ) {}

  @Get('networks')
  @ApiOperation({ summary: 'Redes cripto soportadas (multi-red) para depósito/retiro' })
  networks() {
    // Catálogo público: sin RPC ni datos sensibles.
    return this.config.getOrThrow<NetworksConfig>('networks').list.map((n) => ({
      key: n.key,
      family: n.family,
      name: n.name,
      chainId: n.chainId,
      nativeSymbol: n.nativeSymbol,
      asset: n.asset,
      assets: (n.tokens ?? []).map((t) => t.asset),
      explorerUrl: n.explorerUrl,
      isTestnet: n.isTestnet,
      enabled: n.enabled,
      available: n.available,
    }));
  }

  @Get('accounts/deposit-address')
  @ApiOperation({ summary: 'Dirección de depósito on-chain del usuario (?network=)' })
  depositAddress(@CurrentUser() user: AuthUser, @Query('network') network?: string) {
    return this.custody.depositInfo(user.sub, network);
  }
}

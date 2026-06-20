import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { EvmService } from './evm.service';

@ApiTags('evm')
@Public()
@Controller('evm')
export class EvmController {
  constructor(private readonly evm: EvmService) {}

  @Get('info')
  @ApiOperation({ summary: 'Info de la red EVM real conectada (chainId, último bloque)' })
  info() {
    return this.evm.getInfo();
  }

  @Get('address/:address')
  @ApiOperation({ summary: 'Saldo real (nativo + USDC) de una address en la red EVM' })
  address(@Param('address') address: string) {
    return this.evm.getAddress(address);
  }

  @Get('token/:token/:address')
  @ApiOperation({ summary: 'Saldo de un token ERC-20 para una address' })
  token(@Param('token') token: string, @Param('address') address: string) {
    return this.evm.getTokenBalance(token, address);
  }

  @Get('tx/:hash')
  @ApiOperation({ summary: 'Estado de una transacción on-chain por hash' })
  tx(@Param('hash') hash: string) {
    return this.evm.getTransaction(hash);
  }
}

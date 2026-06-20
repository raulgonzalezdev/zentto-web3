import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @ApiOperation({ summary: 'Crea una wallet (par de claves secp256k1)' })
  create() {
    return this.wallets.createWallet();
  }

  @Get(':address/balance')
  @ApiOperation({ summary: 'Saldo confirmado y disponible de una address' })
  balance(@Param('address') address: string) {
    return this.wallets.getBalance(address);
  }

  @Post('sign')
  @ApiOperation({
    summary: 'Firma una transacción del lado del servidor (solo demo/pruebas)',
  })
  sign(@Body() dto: SignTransactionDto) {
    return this.wallets.sign(dto);
  }
}

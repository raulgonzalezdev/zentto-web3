import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { BlockchainService } from './blockchain.service';
import { SubmitTransactionDto } from './dto/submit-transaction.dto';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Post()
  @ApiOperation({ summary: 'Envía una transacción firmada al mempool (requiere auth)' })
  submit(@Body() dto: SubmitTransactionDto) {
    return this.blockchain.submitTransaction(dto);
  }

  @Public()
  @Get('pending')
  @ApiOperation({ summary: 'Lista las transacciones pendientes (mempool)' })
  pending() {
    return this.blockchain.getPending();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una transacción por id' })
  getOne(@Param('id') id: string) {
    return this.blockchain.getTransaction(id);
  }
}

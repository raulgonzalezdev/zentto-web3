import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { BlockchainService } from './blockchain.service';

@ApiTags('blockchain')
@Public()
@Controller()
export class BlockchainController {
  constructor(private readonly blockchain: BlockchainService) {}

  @Get('chain')
  @ApiOperation({ summary: 'Devuelve la cadena completa con sus bloques' })
  async chain() {
    return {
      height: await this.blockchain.getHeight(),
      blocks: await this.blockchain.getAllBlocks(),
    };
  }

  @Get('chain/validate')
  @ApiOperation({ summary: 'Valida la integridad de toda la cadena' })
  validate() {
    return this.blockchain.validateChain();
  }

  @Get('blocks/:index')
  @ApiOperation({ summary: 'Devuelve un bloque por índice' })
  block(@Param('index', ParseIntPipe) index: number) {
    return this.blockchain.getBlock(index);
  }
}

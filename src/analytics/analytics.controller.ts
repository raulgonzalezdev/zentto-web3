import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CrossChainService } from './cross-chain.service';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly crossChain: CrossChainService) {}

  @Get('graph')
  @ApiOperation({ summary: 'Grafo dirigido completo de transferencias on-chain' })
  graph() {
    return this.crossChain.buildGraph();
  }

  @Get('hubs')
  @ApiOperation({ summary: 'Hubs tipo exchange (alta concentración de fondos)' })
  @ApiQuery({ name: 'minDegree', required: false, type: Number })
  hubs(@Query('minDegree', new DefaultValuePipe(5), ParseIntPipe) minDegree: number) {
    return this.crossChain.detectHubs(minDegree);
  }

  @Get('address/:address/relations')
  @ApiOperation({ summary: 'Relaciones directas (entrantes y salientes) de una address' })
  relations(@Param('address') address: string) {
    return this.crossChain.relations(address);
  }

  @Get('trace')
  @ApiOperation({ summary: 'Traza una ruta de fondos entre dos addresses (BFS)' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  async trace(@Query('from') from: string, @Query('to') to: string) {
    const path = await this.crossChain.traceFunds(from, to);
    return { from, to, path, reachable: path !== null };
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeeService } from './fee.service';

@ApiTags('fees')
@Controller('fees')
export class FeesController {
  constructor(private readonly fees: FeeService) {}

  @Get()
  @ApiOperation({ summary: 'Tarifas de comisión de la plataforma (transparencia)' })
  rates() {
    const r = this.fees.rates;
    return {
      p2pPct: r.p2pPct,
      depositPct: r.depositPct,
      withdrawPct: r.withdrawPct,
      withdrawNetworkFee: r.withdrawNetworkFee,
      minFee: r.minFee,
    };
  }
}

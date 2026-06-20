import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { ScreenDto } from './dto/screen.dto';

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('status')
  @ApiOperation({ summary: 'Indica si la generación de informes con IA está activa' })
  status() {
    return this.compliance.aiStatus();
  }

  @Get('screen/:address')
  @ApiOperation({ summary: 'Screening AML de una address (scoring de riesgo)' })
  screenByPath(@Param('address') address: string) {
    return this.compliance.screen(address);
  }

  @Post('screen')
  @ApiOperation({ summary: 'Screening AML de una address (scoring de riesgo)' })
  screen(@Body() dto: ScreenDto) {
    return this.compliance.screen(dto.address);
  }

  @Post('report')
  @ApiOperation({ summary: 'Informe de cumplimiento completo (scoring + narrativa IA)' })
  report(@Body() dto: ScreenDto) {
    return this.compliance.report(dto.address);
  }
}

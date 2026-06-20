import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MineDto } from '../blockchain/dto/mine.dto';
import { MiningService } from './mining.service';

@ApiTags('mining')
@Controller('mining')
export class MiningController {
  constructor(private readonly mining: MiningService) {}

  @Post()
  @ApiOperation({ summary: 'Encola un trabajo de minado (pipeline asíncrono BullMQ)' })
  mine(@Body() dto: MineDto) {
    return this.mining.enqueueMining(dto.minerAddress);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Estado de un trabajo de minado encolado' })
  jobStatus(@Param('jobId') jobId: string) {
    return this.mining.getJobStatus(jobId);
  }
}

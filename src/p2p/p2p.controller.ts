import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { AddPeerDto } from './dto/add-peer.dto';
import { P2pService } from './p2p.service';

@ApiTags('p2p')
@Controller('p2p')
export class P2pController {
  constructor(private readonly p2p: P2pService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Estado de la red P2P (peers conectados, altura, dedup)' })
  status() {
    return this.p2p.status();
  }

  @Post('peers')
  @ApiOperation({ summary: 'Conecta a un nuevo peer en runtime' })
  addPeer(@Body() dto: AddPeerDto) {
    this.p2p.addPeer(dto.url);
    return { ok: true, peer: dto.url };
  }
}

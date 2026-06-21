import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateP2pOrderDto } from './dto/p2p.dto';
import { P2pMarketService } from './p2p-market.service';

@ApiTags('p2p')
@Controller('p2p')
export class P2pMarketController {
  constructor(private readonly market: P2pMarketService) {}

  @Get('orders')
  @ApiOperation({ summary: 'Order book P2P: ofertas abiertas (?side=&asset=)' })
  list(@Query('side') side?: string, @Query('asset') asset?: string) {
    return this.market.listOpen({ side, asset });
  }

  @Get('orders/mine')
  @ApiOperation({ summary: 'Mis órdenes P2P' })
  mine(@CurrentUser() user: AuthUser) {
    return this.market.listMine(user.sub);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Publicar oferta de compra/venta (venta escrowa el cripto)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateP2pOrderDto) {
    return this.market.createOrder(user.sub, dto);
  }

  @Post('orders/:id/cancel')
  @ApiOperation({ summary: 'Cancelar mi oferta (libera el escrow)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.cancelOrder(user.sub, id);
  }

  @Post('orders/:id/take')
  @ApiOperation({ summary: 'Tomar una oferta → crea el trade (escrow)' })
  take(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.takeOrder(user.sub, id);
  }

  @Get('trades')
  @ApiOperation({ summary: 'Mis trades P2P' })
  trades(@CurrentUser() user: AuthUser) {
    return this.market.myTrades(user.sub);
  }

  @Post('trades/:id/confirm')
  @ApiOperation({ summary: 'Vendedor confirma fiat recibido → libera cripto al comprador' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.confirmTrade(user.sub, id);
  }

  @Post('trades/:id/cancel')
  @ApiOperation({ summary: 'Cancelar trade pendiente (libera el escrow)' })
  cancelTrade(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.cancelTrade(user.sub, id);
  }
}

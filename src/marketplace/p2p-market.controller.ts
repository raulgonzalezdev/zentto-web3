import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateP2pOrderDto, OpenDisputeDto, PostP2pMessageDto } from './dto/p2p.dto';
import { P2pMarketService } from './p2p-market.service';

@ApiTags('p2p')
@Controller('p2p')
export class P2pMarketController {
  constructor(private readonly market: P2pMarketService) {}

  @Get('market')
  @ApiOperation({ summary: 'Precio de referencia USDT/VES + banda de precios permitida' })
  marketRate() {
    return this.market.getMarketRate();
  }

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

  @Get('trades/:id')
  @ApiOperation({ summary: 'Detalle de un trade (solo las partes)' })
  trade(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.getTrade(user.sub, id);
  }

  @Post('trades/:id/confirm')
  @ApiOperation({ summary: 'Vendedor confirma fiat recibido → libera cripto al comprador' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.confirmTrade(user.sub, id);
  }

  @Post('trades/:id/paid')
  @ApiOperation({ summary: 'Comprador marca el fiat como pagado → inicia ventana de liberación' })
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.markPaid(user.sub, id);
  }

  @Post('trades/:id/dispute')
  @ApiOperation({ summary: 'Abrir disputa del trade (la resuelve un árbitro)' })
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: OpenDisputeDto) {
    return this.market.openDispute(user.sub, id, dto.reason);
  }

  @Post('trades/:id/cancel')
  @ApiOperation({ summary: 'Cancelar trade pendiente (libera el escrow)' })
  cancelTrade(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.cancelTrade(user.sub, id);
  }

  @Get('trades/:id/messages')
  @ApiOperation({ summary: 'Chat del trade (mensajes + evidencias)' })
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.listMessages(user.sub, id);
  }

  @Post('trades/:id/messages')
  @ApiOperation({ summary: 'Enviar mensaje o evidencia de pago al chat del trade' })
  sendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PostP2pMessageDto,
  ) {
    return this.market.postMessage(user.sub, id, dto);
  }
}

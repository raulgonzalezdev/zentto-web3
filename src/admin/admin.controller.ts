import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResolveDisputeDto } from '../marketplace/dto/p2p.dto';
import { P2pMarketService } from '../marketplace/p2p-market.service';
import { AdminService } from './admin.service';
import { OperatorGuard } from './operator.guard';

@ApiTags('admin')
@UseGuards(OperatorGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly market: P2pMarketService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Métricas del panel de operaciones (usuarios, KYC, pagos)' })
  stats() {
    return this.admin.stats();
  }

  @Get('treasury')
  @ApiOperation({ summary: 'Cuenta maestra: comisiones ganadas + billetera maestra on-chain' })
  treasury() {
    return this.admin.treasury();
  }

  @Get('users')
  @ApiOperation({ summary: 'Todos los usuarios con estado KYC y saldos' })
  users() {
    return this.admin.listUsers();
  }

  @Get('operators')
  @ApiOperation({ summary: 'Operadores (operator/admin) con su volumen de recargas completadas' })
  operators() {
    return this.admin.listOperators();
  }

  @Get('kyc')
  @ApiOperation({ summary: 'TODAS las verificaciones KYC (filtro ?status=)' })
  kyc(@Query('status') status?: string) {
    return this.admin.listKyc(status);
  }

  @Get('payments')
  @ApiOperation({ summary: 'Todos los pagos del sistema (filtro ?type=)' })
  payments(@Query('type') type?: string) {
    return this.admin.listPayments(type);
  }

  @Post('users/:id/role')
  @ApiOperation({ summary: 'Cambiar el rol de un usuario (user|operator|admin)' })
  setRole(@Param('id') id: string, @Body() body: { role: 'user' | 'operator' | 'admin' }) {
    return this.admin.setRole(id, body?.role);
  }

  // ─────────────────── Arbitraje de disputas P2P ───────────────────

  @Get('p2p/disputes')
  @ApiOperation({ summary: 'Cola de trades en disputa (para el árbitro)' })
  disputes() {
    return this.market.listDisputes();
  }

  @Get('p2p/trades/:id')
  @ApiOperation({ summary: 'Detalle de un trade en disputa (acceso de operador)' })
  disputeTrade(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.getTrade(user.sub, id, true);
  }

  @Get('p2p/trades/:id/messages')
  @ApiOperation({ summary: 'Chat/evidencias del trade en disputa (acceso de operador)' })
  disputeMessages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.listMessages(user.sub, id, true);
  }

  @Post('p2p/trades/:id/resolve')
  @ApiOperation({ summary: 'Resolver disputa: release→comprador o refund→vendedor' })
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.market.resolveDispute(user.sub, id, dto.decision);
  }
}

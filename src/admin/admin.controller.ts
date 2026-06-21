import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { OperatorGuard } from './operator.guard';

@ApiTags('admin')
@UseGuards(OperatorGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Métricas del panel de operaciones (usuarios, KYC, pagos)' })
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  @ApiOperation({ summary: 'Todos los usuarios con estado KYC y saldos' })
  users() {
    return this.admin.listUsers();
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
}

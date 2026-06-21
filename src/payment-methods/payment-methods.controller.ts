import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreatePaymentMethodDto } from './dto/payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

@ApiTags('payment-methods')
@Controller('me/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly service: PaymentMethodsService) {}

  @Get()
  @ApiOperation({ summary: 'Mis métodos de cobro (Pago Móvil / banco)' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar un método de cobro' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentMethodDto) {
    return this.service.create(user.sub, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un método de cobro' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.sub, id);
  }
}

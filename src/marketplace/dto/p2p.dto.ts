import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DECIMAL = /^\d+(\.\d+)?$/;

export class CreateP2pOrderDto {
  @ApiProperty({ enum: ['buy', 'sell'] })
  @IsIn(['buy', 'sell'])
  side!: 'buy' | 'sell';

  @ApiProperty({ example: 'USDT' })
  @IsString()
  asset!: string;

  @ApiProperty({ example: '50', description: 'Cantidad de cripto' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount debe ser un decimal positivo' })
  amount!: string;

  @ApiProperty({ example: '40.50', description: 'Precio por unidad en VES' })
  @IsString()
  @Matches(DECIMAL, { message: 'priceVes debe ser un decimal positivo' })
  priceVes!: string;

  @ApiPropertyOptional({ example: 'Pago Móvil' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethod?: string;
}

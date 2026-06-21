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

export class OpenDisputeDto {
  @ApiProperty({ example: 'Pagué pero el vendedor no libera el cripto' })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ResolveDisputeDto {
  @ApiProperty({ enum: ['release', 'refund'], description: 'release→comprador, refund→vendedor' })
  @IsIn(['release', 'refund'])
  decision!: 'release' | 'refund';
}

export class PostP2pMessageDto {
  @ApiPropertyOptional({ example: 'Te envié el comprobante adjunto' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional({ description: 'Evidencia de pago como data URL (image/png|jpeg|webp)' })
  @IsOptional()
  @IsString()
  attachment?: string;
}

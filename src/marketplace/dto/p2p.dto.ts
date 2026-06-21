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

  @ApiPropertyOptional({ example: 'Pago Móvil · Mercantil', description: 'Etiqueta pública' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentMethod?: string;

  @ApiPropertyOptional({
    example: 'Pago Móvil 0414... · 0105 Mercantil · V-12345678 · Juan Pérez',
    description: 'Datos de pago completos (privados; se revelan al tomar la oferta)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  paymentDetails?: string;
}

export class ConfirmTradeDto {
  @ApiPropertyOptional({ example: '123456', description: 'Código Google Authenticator (2FA)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode debe ser de 6 dígitos' })
  totpCode?: string;
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

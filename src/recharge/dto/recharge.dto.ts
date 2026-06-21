import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DECIMAL = /^\d+(\.\d+)?$/;

export class CreateRechargeDto {
  @ApiProperty({ example: '50', description: 'Cripto (USDC) a recibir' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount debe ser un decimal positivo' })
  amount!: string;

  @ApiProperty({ example: '40.50', description: 'Tasa Bs/USDC' })
  @IsString()
  @Matches(DECIMAL, { message: 'rateVes debe ser un decimal positivo' })
  rateVes!: string;
}

export class SubmitEvidenceDto {
  @ApiProperty({ description: 'Comprobante de pago como data URL (image/png|jpeg|webp)' })
  @IsString()
  attachment!: string;
}

export class ClaimRechargeDto {
  @ApiProperty({
    example: 'Pago Móvil 0414... · 0105 Mercantil · V-12345678 · Juan Pérez',
    description: 'Datos de pago del operador (se muestran al usuario)',
  })
  @IsString()
  @MaxLength(1000)
  operatorPaymentInfo!: string;
}

export class ConfirmRechargeDto {
  @ApiPropertyOptional({ example: '123456', description: 'Código Google Authenticator (2FA)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode debe ser de 6 dígitos' })
  totpCode?: string;
}

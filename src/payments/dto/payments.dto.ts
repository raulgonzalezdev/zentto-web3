import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

const DECIMAL = /^\d+(\.\d+)?$/;
const TOTP = /^\d{6}$/;

export class TransferDto {
  @ApiProperty({ example: 'amigo@zentto.net', description: 'Email del destinatario' })
  @IsEmail()
  toEmail!: string;

  @ApiProperty({ example: 'USDT' })
  @IsString()
  asset!: string;

  @ApiProperty({ example: '10.5', description: 'Importe decimal (string)' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount debe ser un decimal positivo' })
  amount!: string;

  @ApiPropertyOptional({ example: '123456', description: 'Código Google Authenticator (2FA)' })
  @IsOptional()
  @IsString()
  @Matches(TOTP, { message: 'totpCode debe ser de 6 dígitos' })
  totpCode?: string;
}

export class CreditDto {
  @ApiProperty({ example: 'USDT' })
  @IsString()
  asset!: string;

  @ApiProperty({ example: '100' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount debe ser un decimal positivo' })
  amount!: string;
}

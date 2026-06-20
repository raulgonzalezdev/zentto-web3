import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const DECIMAL = /^\d+(\.\d+)?$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TOTP = /^\d{6}$/;

export class WithdrawDto {
  @ApiProperty({ example: 'USDC' })
  @IsString()
  asset!: string;

  @ApiProperty({ example: '25.5', description: 'Importe decimal (string)' })
  @IsString()
  @Matches(DECIMAL, { message: 'amount debe ser un decimal positivo' })
  amount!: string;

  @ApiProperty({ example: '0x1234…', description: 'Address EVM de destino' })
  @IsString()
  @Matches(EVM_ADDRESS, { message: 'toAddress debe ser una address EVM válida' })
  toAddress!: string;

  @ApiProperty({
    example: '123456',
    description: 'Código de Google Authenticator (TOTP, 6 dígitos)',
  })
  @IsOptional()
  @IsString()
  @Matches(TOTP, { message: 'totpCode debe ser de 6 dígitos' })
  totpCode?: string;
}

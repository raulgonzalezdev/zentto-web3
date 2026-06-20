import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches } from 'class-validator';

const DECIMAL = /^\d+(\.\d+)?$/;

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

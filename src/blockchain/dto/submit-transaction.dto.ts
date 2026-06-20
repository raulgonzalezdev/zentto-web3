import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, IsString, Min } from 'class-validator';

export class SubmitTransactionDto {
  @ApiProperty({ description: 'Address (clave pública) del emisor' })
  @IsString()
  fromAddress!: string;

  @ApiProperty({ description: 'Address del receptor' })
  @IsString()
  toAddress!: string;

  @ApiProperty({ example: 100, description: 'Monto a transferir' })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 1, description: 'Comisión para el minero', default: 0 })
  @IsNumber()
  @Min(0)
  fee = 0;

  @ApiProperty({ description: 'Timestamp (ms) usado al firmar la transacción' })
  @IsInt()
  timestamp!: number;

  @ApiProperty({ description: 'Firma DER en hex generada con la clave privada del emisor' })
  @IsString()
  signature!: string;
}

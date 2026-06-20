import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

/**
 * Helper de conveniencia para entornos de prueba: firma una transacción del
 * lado del servidor a partir de la clave privada. En producción la firma se
 * haría en el cliente y la clave privada NUNCA viajaría a la API.
 */
export class SignTransactionDto {
  @ApiProperty({ description: 'Clave privada del emisor (solo para demo/pruebas)' })
  @IsString()
  privateKey!: string;

  @ApiProperty({ description: 'Address del receptor' })
  @IsString()
  toAddress!: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 1, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fee = 0;

  @ApiProperty({ required: false, description: 'Timestamp (ms); si se omite se usa el actual' })
  @IsOptional()
  @IsInt()
  timestamp?: number;
}

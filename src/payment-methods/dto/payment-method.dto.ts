import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePaymentMethodDto {
  @ApiProperty({ enum: ['pago_movil', 'bank_account'] })
  @IsIn(['pago_movil', 'bank_account'])
  type!: 'pago_movil' | 'bank_account';

  @ApiProperty({ example: 'Mi Pago Móvil' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;

  @ApiPropertyOptional({ example: 'Banco de Venezuela' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({ example: 'Raúl González' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolder?: string;

  @ApiPropertyOptional({ example: 'V-7786676' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  idNumber?: string;

  @ApiPropertyOptional({ example: '0414-1234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: '0102-0000-00-0000000000' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNumber?: string;
}

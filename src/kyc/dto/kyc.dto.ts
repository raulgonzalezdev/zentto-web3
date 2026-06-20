import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class KycSubmitDto {
  @ApiProperty({ example: 'JUAN PEREZ GARCIA' })
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  fullName!: string;

  @ApiProperty({ example: 'passport', enum: ['passport', 'id_card'] })
  @IsIn(['passport', 'id_card'])
  documentType!: 'passport' | 'id_card';

  @ApiPropertyOptional({ example: 'X1234567', description: 'Número de documento (si no hay MRZ)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  documentNumber?: string;

  @ApiPropertyOptional({ description: 'MRZ TD3 (88 caracteres) leída del pasaporte' })
  @IsOptional()
  @IsString()
  mrz?: string;
}

export class KycDecisionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({ example: 'Documento legible, liveness OK' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

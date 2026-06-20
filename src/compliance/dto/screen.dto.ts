import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ScreenDto {
  @ApiProperty({ description: 'Address on-chain a evaluar' })
  @IsString()
  address!: string;
}

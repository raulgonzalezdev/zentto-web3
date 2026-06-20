import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class MineDto {
  @ApiProperty({ description: 'Address del minero que recibirá la recompensa' })
  @IsString()
  minerAddress!: string;
}

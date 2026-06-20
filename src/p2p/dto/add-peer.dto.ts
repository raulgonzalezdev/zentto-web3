import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AddPeerDto {
  @ApiProperty({ example: 'ws://node2:6001', description: 'URL WebSocket del peer' })
  @IsString()
  @Matches(/^wss?:\/\/.+/, { message: 'url debe empezar por ws:// o wss://' })
  url!: string;
}

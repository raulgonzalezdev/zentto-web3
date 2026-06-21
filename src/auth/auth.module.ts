import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountTokenEntity } from '../database/entities/account-token.entity';
import { UserEntity } from '../database/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountTokenService } from './account-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, AccountTokenEntity]),
    JwtModule.register({}),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, AccountTokenService],
  exports: [AuthService, TokenService, JwtModule],
})
export class AuthModule {}

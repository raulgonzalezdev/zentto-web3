import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthConfig } from '../../config/configuration';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ACCESS_COOKIE } from '../auth.constants';

/**
 * Guard JWT global. Lee el access token desde la cookie httpOnly (nunca de
 * Authorization/localStorage). Las rutas marcadas con @Public() se omiten.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly auth: AuthConfig;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.auth = config.getOrThrow<AuthConfig>('auth');
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('No autenticado');

    try {
      const payload = this.jwt.verify(token, { secret: this.auth.jwtSecret });
      req.user = { sub: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Sesión inválida o expirada');
    }
  }
}

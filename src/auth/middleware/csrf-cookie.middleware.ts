import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AuthConfig } from '../../config/configuration';
import { CSRF_COOKIE } from '../auth.constants';

/**
 * Siembra la cookie CSRF (legible por el front) si aún no existe. Así cualquier
 * primera petición GET deja al cliente listo para enviar el header en mutaciones.
 */
@Injectable()
export class CsrfCookieMiddleware implements NestMiddleware {
  private readonly auth: AuthConfig;

  constructor(config: ConfigService) {
    this.auth = config.getOrThrow<AuthConfig>('auth');
  }

  use(req: Request, res: Response, next: NextFunction) {
    if (!req.cookies?.[CSRF_COOKIE]) {
      const token = randomBytes(24).toString('hex');
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false, // el front debe leerla para reenviarla como header
        secure: this.auth.cookieSecure,
        sameSite: this.auth.cookieSameSite,
        domain: this.auth.cookieDomain || undefined,
        path: '/',
      });
    }
    next();
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CookieOptions, Response } from 'express';
import { AuthConfig } from '../config/configuration';
import { UserEntity } from '../database/entities/user.entity';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants';

export interface RefreshPayload {
  sub: string;
  tokenVersion: number;
}

/**
 * Firma los JWT y los escribe/borra como cookies httpOnly. Los tokens NUNCA se
 * devuelven en el body — viven solo en cookies httpOnly (no accesibles por JS).
 */
@Injectable()
export class TokenService {
  private readonly auth: AuthConfig;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.auth = config.getOrThrow<AuthConfig>('auth');
  }

  private baseCookie(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.auth.cookieSecure,
      sameSite: this.auth.cookieSameSite,
      domain: this.auth.cookieDomain || undefined,
      path: '/',
    };
  }

  /** Convierte un TTL tipo '15m' / '7d' / '24h' / '900s' a milisegundos. */
  private ttlToMs(ttl: string): number {
    const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]] ?? 0;
    return n * mult;
  }

  signAccess(user: Pick<UserEntity, 'id' | 'email' | 'role'>): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { secret: this.auth.jwtSecret, expiresIn: this.auth.accessTtl },
    );
  }

  signRefresh(user: Pick<UserEntity, 'id' | 'tokenVersion'>): string {
    return this.jwt.sign(
      { sub: user.id, tokenVersion: user.tokenVersion },
      { secret: this.auth.jwtRefreshSecret, expiresIn: this.auth.refreshTtl },
    );
  }

  verifyRefresh(token: string): RefreshPayload {
    return this.jwt.verify<RefreshPayload>(token, { secret: this.auth.jwtRefreshSecret });
  }

  /** Firma una mfa-token de corta vida usada entre login y verificación 2FA. */
  signMfaTicket(userId: string): string {
    return this.jwt.sign(
      { sub: userId, mfa: true },
      { secret: this.auth.jwtSecret, expiresIn: '5m' },
    );
  }

  verifyMfaTicket(token: string): { sub: string } {
    const payload = this.jwt.verify<{ sub: string; mfa?: boolean }>(token, {
      secret: this.auth.jwtSecret,
    });
    if (!payload.mfa) throw new Error('No es un ticket MFA');
    return { sub: payload.sub };
  }

  issueSession(res: Response, user: UserEntity): void {
    // maxAge => cookies PERSISTENTES (sobreviven cerrar la app/WebView). Sin él
    // serían "de sesión" y Android las borra al cerrar → re-login en cada apertura.
    res.cookie(ACCESS_COOKIE, this.signAccess(user), {
      ...this.baseCookie(),
      maxAge: this.ttlToMs(this.auth.accessTtl) || 15 * 60_000,
    });
    res.cookie(REFRESH_COOKIE, this.signRefresh(user), {
      ...this.baseCookie(),
      maxAge: this.ttlToMs(this.auth.refreshTtl) || 7 * 86_400_000,
    });
  }

  clearSession(res: Response): void {
    const opts = this.baseCookie();
    res.clearCookie(ACCESS_COOKIE, opts);
    res.clearCookie(REFRESH_COOKIE, opts);
  }
}

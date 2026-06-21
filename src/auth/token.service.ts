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
    res.cookie(ACCESS_COOKIE, this.signAccess(user), this.baseCookie());
    res.cookie(REFRESH_COOKIE, this.signRefresh(user), { ...this.baseCookie() });
  }

  clearSession(res: Response): void {
    const opts = this.baseCookie();
    res.clearCookie(ACCESS_COOKIE, opts);
    res.clearCookie(REFRESH_COOKIE, opts);
  }
}

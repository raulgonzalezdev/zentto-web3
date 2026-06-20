import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { AuthConfig } from '../config/configuration';
import { UserEntity } from '../database/entities/user.entity';
import { TokenService } from './token.service';

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  totpEnabled: boolean;
}

@Injectable()
export class AuthService {
  private readonly auth: AuthConfig;

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly tokens: TokenService,
    config: ConfigService,
  ) {
    this.auth = config.getOrThrow<AuthConfig>('auth');
  }

  toPublic(u: UserEntity): PublicUser {
    return { id: u.id, email: u.email, displayName: u.displayName, totpEnabled: u.totpEnabled };
  }

  async getById(id: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    return user;
  }

  // ───────────────────────────── Registro ─────────────────────────────

  async register(email: string, password: string, displayName?: string): Promise<UserEntity> {
    const normalized = email.trim().toLowerCase();
    const exists = await this.users.findOne({ where: { email: normalized } });
    if (exists) throw new ConflictException('El email ya está registrado');

    const user = this.users.create({
      id: randomUUID(),
      email: normalized,
      displayName: displayName ?? null,
      passwordHash: await bcrypt.hash(password, this.auth.bcryptRounds),
      totpEnabled: false,
      totpSecret: null,
      tokenVersion: 0,
    });
    return this.users.save(user);
  }

  // ───────────────────────────── Login ─────────────────────────────

  /** Valida credenciales. No emite sesión: eso lo decide el controller según 2FA. */
  async validateCredentials(email: string, password: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    return user;
  }

  /** Verifica el código TOTP del usuario contra su secreto activo. */
  verifyTotp(user: UserEntity, code: string): boolean {
    if (!user.totpSecret) return false;
    return authenticator.verify({ token: code, secret: user.totpSecret });
  }

  // ─────────────────────────── 2FA (TOTP) ───────────────────────────

  /** Genera (o regenera) un secreto TOTP pendiente y devuelve el QR para escanear. */
  async setupTotp(
    userId: string,
  ): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    const user = await this.getById(userId);
    if (user.totpEnabled) {
      throw new BadRequestException('El 2FA ya está activo; desactívalo antes de regenerar');
    }
    const secret = authenticator.generateSecret();
    user.totpSecret = secret;
    await this.users.save(user);

    const otpauthUrl = authenticator.keyuri(user.email, this.auth.totpIssuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { otpauthUrl, qrDataUrl, secret };
  }

  /** Activa el 2FA tras verificar el primer código generado por la app. */
  async enableTotp(userId: string, code: string): Promise<void> {
    const user = await this.getById(userId);
    if (!user.totpSecret) throw new BadRequestException('Primero inicia la configuración del 2FA');
    if (!this.verifyTotp(user, code)) throw new UnauthorizedException('Código TOTP inválido');
    user.totpEnabled = true;
    await this.users.save(user);
  }

  /** Desactiva el 2FA (requiere un código válido). */
  async disableTotp(userId: string, code: string): Promise<void> {
    const user = await this.getById(userId);
    if (!user.totpEnabled) throw new BadRequestException('El 2FA no está activo');
    if (!this.verifyTotp(user, code)) throw new UnauthorizedException('Código TOTP inválido');
    user.totpEnabled = false;
    user.totpSecret = null;
    await this.users.save(user);
  }

  // ─────────────────────── Refresh / revocación ───────────────────────

  /** Valida el refresh token (firma + versión) y devuelve el usuario. */
  async validateRefresh(token: string): Promise<UserEntity> {
    let payload;
    try {
      payload = this.tokens.verifyRefresh(token);
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    const user = await this.getById(payload.sub);
    if (payload.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Sesión revocada');
    }
    return user;
  }

  /** Revoca todos los refresh tokens del usuario (logout global). */
  async revokeTokens(userId: string): Promise<void> {
    const user = await this.getById(userId);
    user.tokenVersion += 1;
    await this.users.save(user);
  }
}

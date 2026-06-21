import {
  BadRequestException,
  ConflictException,
  HttpException,
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
import { AppConfig, AuthConfig } from '../config/configuration';
import { UserEntity } from '../database/entities/user.entity';
import { NotifyService } from '../notifications/notify.service';
import { AccountTokenService } from './account-token.service';
import { resetPasswordTemplate, verifyEmailTemplate } from './email-templates';
import { TokenService } from './token.service';

export type UserRole = 'user' | 'operator' | 'admin';

/** Bloqueo por fuerza bruta: tras 5 fallos consecutivos, 15 minutos de cuarentena. */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  totpEnabled: boolean;
  emailVerified: boolean;
  role: UserRole;
}

@Injectable()
export class AuthService {
  private readonly auth: AuthConfig;
  private readonly operatorEmails: string[];

  private readonly appUrl: string;

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly tokens: TokenService,
    private readonly accountTokens: AccountTokenService,
    private readonly notify: NotifyService,
    config: ConfigService,
  ) {
    this.auth = config.getOrThrow<AuthConfig>('auth');
    const app = config.getOrThrow<AppConfig>('app');
    this.operatorEmails = app.operatorEmails;
    this.appUrl = app.url.replace(/\/$/, '');
  }

  /** Rol de arranque: los emails en OPERATOR_EMAILS son admin del backoffice. */
  private bootstrapRole(email: string): UserRole {
    return this.operatorEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
  }

  toPublic(u: UserEntity): PublicUser {
    return {
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      totpEnabled: u.totpEnabled,
      emailVerified: u.emailVerified,
      role: u.role,
    };
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
      role: this.bootstrapRole(normalized),
      passwordHash: await bcrypt.hash(password, this.auth.bcryptRounds),
      totpEnabled: false,
      totpSecret: null,
      emailVerified: false,
      tokenVersion: 0,
      passwordChangedAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    const saved = await this.users.save(user);
    // El email de verificación es best-effort: no debe bloquear el registro
    // (el controller emite sesión al instante, igual que antes).
    await this.sendVerificationEmail(saved);
    return saved;
  }

  // ──────────────────────── Verificación de email ────────────────────────

  private async sendVerificationEmail(user: UserEntity): Promise<void> {
    const token = await this.accountTokens.issue(user.id, 'verify_email', VERIFY_TOKEN_TTL_MS);
    const link = `${this.appUrl}/verificar?token=${token}`;
    const { subject, html } = verifyEmailTemplate(link);
    await this.notify.sendEmail({ to: user.email, subject, html });
  }

  /** Valida el token de verificación y marca el email como verificado. */
  async verifyEmail(token: string): Promise<void> {
    const record = await this.accountTokens.validate(token, 'verify_email');
    if (!record) throw new BadRequestException('Token de verificación inválido o expirado');
    const user = await this.getById(record.userId);
    if (!user.emailVerified) {
      user.emailVerified = true;
      await this.users.save(user);
    }
    await this.accountTokens.consume(record.id);
  }

  /** Reenvía el email de verificación si la cuenta aún no está verificada. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.getById(userId);
    if (user.emailVerified) {
      throw new BadRequestException('El correo ya está verificado');
    }
    await this.sendVerificationEmail(user);
  }

  // ────────────────────── Recuperación de contraseña ──────────────────────

  /**
   * Inicia el flujo de reset. SIEMPRE resuelve sin error y sin revelar si el
   * email existe (anti-enumeración). Si existe, emite token + envía email.
   */
  async forgotPassword(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user) return; // no se revela la inexistencia
    const token = await this.accountTokens.issue(user.id, 'reset_password', RESET_TOKEN_TTL_MS);
    const link = `${this.appUrl}/restablecer?token=${token}`;
    const { subject, html } = resetPasswordTemplate(link);
    await this.notify.sendEmail({ to: user.email, subject, html });
  }

  /**
   * Completa el reset: valida el token, cambia el hash, invalida todas las
   * sesiones (tokenVersion++), desbloquea la cuenta y marca passwordChangedAt.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.accountTokens.validate(token, 'reset_password');
    if (!record) throw new BadRequestException('Token de restablecimiento inválido o expirado');
    const user = await this.getById(record.userId);
    user.passwordHash = await bcrypt.hash(newPassword, this.auth.bcryptRounds);
    user.tokenVersion += 1; // logout global: invalida refresh tokens vigentes
    user.passwordChangedAt = new Date();
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    await this.accountTokens.consume(record.id);
  }

  // ───────────────────────────── Login ─────────────────────────────

  /**
   * Valida credenciales con bloqueo anti-fuerza-bruta. No emite sesión: eso lo
   * decide el controller según 2FA.
   *
   * Lockout: 5 fallos consecutivos → 15 min bloqueada. Login OK resetea el
   * contador. Una cuenta bloqueada responde 423 con el tiempo restante.
   */
  async validateCredentials(email: string, password: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      // 423 Locked: la cuenta está temporalmente bloqueada por fuerza bruta.
      throw new HttpException(
        `Cuenta bloqueada por demasiados intentos. Reintenta en ${mins} min.`,
        423,
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.failedLoginCount += 1;
      if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
        user.failedLoginCount = 0; // arranca de cero tras el periodo de bloqueo
      }
      await this.users.save(user);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Éxito: limpia el contador y cualquier bloqueo previo expirado.
    if (user.failedLoginCount !== 0 || user.lockedUntil) {
      user.failedLoginCount = 0;
      user.lockedUntil = null;
    }
    // Bootstrap: promueve a admin si su email está en OPERATOR_EMAILS.
    const expected = this.bootstrapRole(user.email);
    if (expected === 'admin' && user.role !== 'admin') {
      user.role = 'admin';
    }
    await this.users.save(user);
    return user;
  }

  /** Verifica el código TOTP del usuario contra su secreto activo. */
  verifyTotp(user: UserEntity, code: string): boolean {
    if (!user.totpSecret) return false;
    return authenticator.verify({ token: code, secret: user.totpSecret });
  }

  /**
   * Step-up de autenticación para operaciones sensibles (mover dinero): exige un
   * código TOTP válido de Google Authenticator. Reutilizado por transferencias,
   * liberación de cripto P2P y retiros. Si el usuario no tiene 2FA, lo obliga a
   * activarlo antes de operar (garantía de segundo factor para los fondos).
   */
  async assertStepUp(userId: string, totpCode?: string): Promise<void> {
    const user = await this.getById(userId);
    if (!user.totpEnabled) {
      throw new BadRequestException(
        'Activa Google Authenticator (2FA) para autorizar movimientos de dinero',
      );
    }
    if (!totpCode) {
      throw new BadRequestException('Código de Google Authenticator requerido para autorizar');
    }
    if (!this.verifyTotp(user, totpCode)) {
      throw new UnauthorizedException('Código de Google Authenticator inválido');
    }
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

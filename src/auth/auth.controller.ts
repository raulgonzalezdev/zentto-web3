import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CSRF_COOKIE, REFRESH_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TotpCodeDto,
  TwoFactorLoginDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { TokenService } from './token.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Get('csrf')
  @ApiOperation({ summary: 'Devuelve el token CSRF (también sembrado como cookie legible)' })
  csrf(@Req() req: Request) {
    return { csrfToken: req.cookies?.[CSRF_COOKIE] ?? null };
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Registra un usuario e inicia sesión (cookies httpOnly)' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(dto.email, dto.password, dto.displayName);
    this.tokens.issueSession(res, user);
    return { user: this.auth.toPublic(user) };
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login. Si hay 2FA activo, devuelve un ticket MFA en vez de sesión' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateCredentials(dto.email, dto.password);
    if (user.totpEnabled) {
      return { mfaRequired: true, mfaToken: this.tokens.signMfaTicket(user.id) };
    }
    this.tokens.issueSession(res, user);
    return { mfaRequired: false, user: this.auth.toPublic(user) };
  }

  @Public()
  @Post('login/2fa')
  @ApiOperation({ summary: 'Completa el login verificando el código TOTP' })
  async loginTwoFactor(@Body() dto: TwoFactorLoginDto, @Res({ passthrough: true }) res: Response) {
    let userId: string;
    try {
      userId = this.tokens.verifyMfaTicket(dto.mfaToken).sub;
    } catch {
      return this.fail(res);
    }
    const user = await this.auth.getById(userId);
    if (!this.auth.verifyTotp(user, dto.code)) {
      return this.fail(res);
    }
    this.tokens.issueSession(res, user);
    return { user: this.auth.toPublic(user) };
  }

  private fail(res: Response) {
    res.status(401);
    return { error: 'Código TOTP o ticket inválido' };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rota la sesión usando el refresh token (cookie httpOnly)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      res.status(401);
      return { error: 'Sin refresh token' };
    }
    const user = await this.auth.validateRefresh(token);
    this.tokens.issueSession(res, user);
    return { user: this.auth.toPublic(user) };
  }

  @Public()
  @Post('verify-email')
  @ApiOperation({ summary: 'Verifica el correo a partir del token enviado por email' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { ok: true };
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Reenvía el email de verificación (si no está verificado)' })
  async resendVerification(@CurrentUser() current: AuthUser) {
    await this.auth.resendVerification(current.sub);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Solicita un email de restablecimiento (siempre responde 200)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    // Respuesta neutra: no revela si el email existe (anti-enumeración).
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Cambia la contraseña con el token de restablecimiento' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Usuario autenticado actual' })
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.auth.getById(current.sub);
    return { user: this.auth.toPublic(user) };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Cierra sesión y revoca los refresh tokens' })
  async logout(@CurrentUser() current: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeTokens(current.sub);
    this.tokens.clearSession(res);
    return { ok: true };
  }

  @Post('2fa/setup')
  @ApiOperation({ summary: 'Inicia configuración de 2FA: devuelve QR + otpauth URL' })
  setupTotp(@CurrentUser() current: AuthUser) {
    return this.auth.setupTotp(current.sub);
  }

  @Post('2fa/enable')
  @ApiOperation({ summary: 'Activa el 2FA verificando el primer código' })
  async enableTotp(@CurrentUser() current: AuthUser, @Body() dto: TotpCodeDto) {
    await this.auth.enableTotp(current.sub, dto.code);
    return { ok: true };
  }

  @Post('2fa/disable')
  @ApiOperation({ summary: 'Desactiva el 2FA' })
  async disableTotp(@CurrentUser() current: AuthUser, @Body() dto: TotpCodeDto) {
    await this.auth.disableTotp(current.sub, dto.code);
    return { ok: true };
  }
}

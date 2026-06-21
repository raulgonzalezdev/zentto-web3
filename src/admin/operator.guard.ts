import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../config/configuration';

/**
 * Gate de operador del backoffice. Si `OPERATOR_EMAILS` está configurado, solo
 * esos emails acceden a /admin/*. Vacío = cualquier autenticado (modo dev).
 * Corre DESPUÉS del JwtAuthGuard, así que `req.user` ya existe.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  private readonly operators: string[];

  constructor(config: ConfigService) {
    this.operators = config.getOrThrow<AppConfig>('app').operatorEmails;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { email?: string; role?: string } }>();
    const role = req.user?.role;
    if (role === 'admin' || role === 'operator') return true;
    // Fallback (tokens viejos sin rol / bootstrap): email en OPERATOR_EMAILS.
    const email = (req.user?.email ?? '').toLowerCase();
    if (this.operators.length > 0 && this.operators.includes(email)) return true;
    // Sin lista y sin rol elevado: en dev se permite a autenticados.
    if (this.operators.length === 0 && !role) return true;
    throw new ForbiddenException('Acceso restringido a operadores del backoffice');
  }
}

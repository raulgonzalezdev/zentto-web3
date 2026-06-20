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
    if (this.operators.length === 0) return true; // dev: sin lista, abierto a autenticados
    const req = context.switchToHttp().getRequest<Request & { user?: { email?: string } }>();
    const email = (req.user?.email ?? '').toLowerCase();
    if (!this.operators.includes(email)) {
      throw new ForbiddenException('Acceso restringido a operadores del backoffice');
    }
    return true;
  }
}

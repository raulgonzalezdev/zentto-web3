import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotifyConfig } from '../config/configuration';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/**
 * Cliente del microservicio zentto-notify para emails transaccionales
 * (verificación de cuenta, recuperación de contraseña, etc.).
 *
 * Llama `POST {NOTIFY_BASE_URL}/api/email/send` con header `x-api-key`.
 *
 * Diseño tolerante a fallos: el envío NUNCA tumba el flujo de negocio. Si notify
 * no responde o no hay API key configurada (dev/CI), se loguea y se continúa.
 * Así un registro o un forgot-password siempre cierran su transacción aunque el
 * correo no salga.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  private readonly cfg: NotifyConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<NotifyConfig>('notify');
  }

  /** True si hay API key => se intenta el envío real. Vacío => modo dry-run (log). */
  get enabled(): boolean {
    return !!this.cfg.apiKey;
  }

  async sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
    if (!this.enabled) {
      // Dev/CI: sin API key no se envía nada; se deja traza para depurar el flujo.
      this.logger.log(`[dry-run] Email a ${to} — "${subject}" (NOTIFY_API_KEY vacío, no enviado)`);
      return;
    }
    try {
      const res = await fetch(`${this.cfg.baseUrl}/api/email/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.cfg.apiKey,
        },
        body: JSON.stringify({ to, subject, html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`notify /api/email/send → ${res.status}: ${body.slice(0, 200)}`);
        return;
      }
      this.logger.log(`Email enviado a ${to} — "${subject}"`);
    } catch (err) {
      // Nunca propaga: el flujo de negocio sigue aunque notify esté caído.
      this.logger.error(`Fallo enviando email a ${to}: ${(err as Error).message}`);
    }
  }
}

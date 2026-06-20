import { Logger } from '@nestjs/common';
import { KycProvider, ProviderSession } from './kyc-provider';

export interface DiditOptions {
  apiKey: string;
  baseUrl: string;
  workflowId: string;
  callbackUrl: string;
}

/**
 * Adaptador para Didit (https://didit.me) — KYC gratuito (ID + liveness + face
 * match). Cubre SOLO la parte adversarial; el resto del flujo es nuestro.
 *
 * Crea una sesión real vía `POST {base}/v3/session/` con `X-API-Key`. El
 * resultado llega después por webhook firmado (ver didit-webhook.util). Sin
 * apiKey o sin workflowId cae a `in_review` (no rompe el flujo).
 */
export class DiditProvider implements KycProvider {
  readonly name = 'didit';
  private readonly logger = new Logger(DiditProvider.name);

  constructor(private readonly opts: DiditOptions) {}

  async createSession(input: {
    userId: string;
    fullName: string | null;
  }): Promise<ProviderSession> {
    if (!this.opts.apiKey || !this.opts.workflowId) {
      this.logger.warn('Didit sin API key o workflow_id: la verificación queda en revisión manual');
      return { ref: null, redirectUrl: null, initialStatus: 'in_review' };
    }
    try {
      const res = await fetch(`${this.opts.baseUrl}/v3/session/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.opts.apiKey },
        body: JSON.stringify({
          workflow_id: this.opts.workflowId,
          vendor_data: input.userId, // mapea el webhook de vuelta a nuestro usuario
          ...(this.opts.callbackUrl ? { callback: this.opts.callbackUrl } : {}),
        }),
      });
      const data = (await res.json()) as { session_id?: string; url?: string; message?: string };
      if (res.status === 201 && data.session_id) {
        return { ref: data.session_id, redirectUrl: data.url ?? null, initialStatus: 'pending' };
      }
      this.logger.error(
        `Didit create-session falló (${res.status}): ${data.message ?? JSON.stringify(data)}`,
      );
    } catch (err) {
      this.logger.error(`Didit create-session error: ${(err as Error).message}`);
    }
    // Degradación segura: a revisión manual si el proveedor no responde.
    return { ref: null, redirectUrl: null, initialStatus: 'in_review' };
  }
}

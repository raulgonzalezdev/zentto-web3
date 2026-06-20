import { Logger } from '@nestjs/common';
import { KycProvider, ProviderSession } from './kyc-provider';

/**
 * Adaptador para Didit (https://didit.me) — KYC gratuito (ID + liveness + face
 * match). Cubre SOLO la parte adversarial; el resto del flujo es nuestro.
 *
 * Stub funcional: con `apiKey` crea una sesión real vía su API; sin key cae a
 * `in_review` (no rompe el flujo). La integración HTTP concreta se completa al
 * tener credenciales (endpoint de creación de sesión + webhook de resultado).
 */
export class DiditProvider implements KycProvider {
  readonly name = 'didit';
  private readonly logger = new Logger(DiditProvider.name);

  constructor(private readonly apiKey: string) {}

  async createSession(input: {
    userId: string;
    fullName: string | null;
  }): Promise<ProviderSession> {
    if (!this.apiKey) {
      this.logger.warn('DIDIT_API_KEY ausente: la verificación queda en revisión manual');
      return { ref: null, redirectUrl: null, initialStatus: 'in_review' };
    }
    // TODO(integración): POST https://verification.didit.me/v1/session con apiKey,
    // mapear { session_id, url } → { ref, redirectUrl }. Webhook actualiza el estado.
    await Promise.resolve();
    return { ref: `didit_${input.userId}`, redirectUrl: null, initialStatus: 'pending' };
  }
}

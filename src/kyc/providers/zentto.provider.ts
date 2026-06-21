import { Logger } from '@nestjs/common';
import { KycProvider, ProviderSession } from './kyc-provider';

export interface ZenttoKycOptions {
  /** Base URL del microservicio self-hosted Zentto KYC (ej. https://kyc.zentto.net). */
  baseUrl: string;
  /** API key del servicio (header X-API-Key). Vacío => cae a revisión manual. */
  apiKey: string;
  /** URL a la que Zentto KYC redirige al usuario tras completar la verificación. */
  callbackUrl: string;
}

/**
 * Adaptador para Zentto KYC — microservicio self-hosted que REEMPLAZA a Didit
 * (alternativa gratis, sin proveedor externo de pago). Cubre SOLO la parte
 * adversarial (ID + liveness + face match + AML); el resto del flujo es nuestro.
 *
 * Crea una sesión real vía `POST {base}/v1/sessions` con `X-API-Key`. El
 * resultado llega después por webhook (mismo flujo que Didit). Sin baseUrl o sin
 * apiKey cae a `in_review` (no rompe el flujo).
 */
export class ZenttoKycProvider implements KycProvider {
  readonly name = 'zentto';
  private readonly logger = new Logger(ZenttoKycProvider.name);

  constructor(private readonly opts: ZenttoKycOptions) {}

  async createSession(input: {
    userId: string;
    fullName: string | null;
  }): Promise<ProviderSession> {
    if (!this.opts.baseUrl || !this.opts.apiKey) {
      this.logger.warn(
        'Zentto KYC sin URL o API key: la verificación queda en revisión manual',
      );
      return { ref: null, redirectUrl: null, initialStatus: 'in_review' };
    }
    try {
      const res = await fetch(`${this.opts.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.opts.apiKey },
        body: JSON.stringify({
          features: ['id', 'liveness', 'face_match', 'aml'],
          vendorData: input.userId, // mapea el webhook de vuelta a nuestro usuario
          ...(this.opts.callbackUrl ? { callbackUrl: this.opts.callbackUrl } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        session?: {
          id?: string;
          status?: string;
          sessionToken?: string;
          verificationUrl?: string;
          features?: string[];
        };
      };
      if ((res.status === 200 || res.status === 201) && data.ok && data.session?.id) {
        return {
          ref: data.session.id,
          redirectUrl: data.session.verificationUrl ?? null,
          initialStatus: 'pending',
        };
      }
      this.logger.error(
        `Zentto KYC create-session falló (${res.status}): ${data.message ?? JSON.stringify(data)}`,
      );
    } catch (err) {
      this.logger.error(`Zentto KYC create-session error: ${(err as Error).message}`);
    }
    // Degradación segura: a revisión manual si el servicio no responde.
    return { ref: null, redirectUrl: null, initialStatus: 'in_review' };
  }
}

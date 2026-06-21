import { Logger } from '@nestjs/common';
import { KycProvider, ProviderSession } from './kyc-provider';

export interface ZenttoKycOptions {
  apiKey: string;
  baseUrl: string;
  callbackUrl: string;
}

/**
 * Proveedor KYC NATIVO de Zentto (servicio propio `zentto-kyc`, kyc.zentto.net).
 * Crea una sesión vía `POST {base}/v1/sessions` con `X-API-Key: zkyc_...` y
 * `vendorData = userId`. El resultado llega por webhook firmado (X-Zentto-Signature).
 *
 * Si Zentto KYC no responde y hay un `fallback` (Didit), se delega en él; si no,
 * cae a revisión manual (no rompe el flujo).
 */
export class ZenttoKycProvider implements KycProvider {
  readonly name = 'zentto-kyc';
  private readonly logger = new Logger(ZenttoKycProvider.name);

  constructor(
    private readonly opts: ZenttoKycOptions,
    private readonly fallback?: KycProvider,
  ) {}

  async createSession(input: {
    userId: string;
    fullName: string | null;
  }): Promise<ProviderSession> {
    if (!this.opts.apiKey) {
      this.logger.warn('Zentto KYC sin API key — usando fallback/revisión manual');
      return this.fallbackSession(input);
    }
    try {
      const res = await fetch(`${this.opts.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.opts.apiKey },
        body: JSON.stringify({
          vendorData: input.userId, // mapea el webhook de vuelta a nuestro usuario
          features: ['id', 'liveness', 'face_match', 'aml'],
          ...(this.opts.callbackUrl ? { callbackUrl: this.opts.callbackUrl } : {}),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        session?: { id?: string; verificationUrl?: string };
        message?: string;
      };
      if (res.status === 201 && data.session?.id) {
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
    return this.fallbackSession(input);
  }

  /** Degradación: Didit si está configurado; si no, revisión manual. */
  private async fallbackSession(input: {
    userId: string;
    fullName: string | null;
  }): Promise<ProviderSession> {
    if (this.fallback) {
      this.logger.warn(`Zentto KYC no disponible → fallback a ${this.fallback.name}`);
      return this.fallback.createSession(input);
    }
    return { ref: null, redirectUrl: null, initialStatus: 'in_review' };
  }
}

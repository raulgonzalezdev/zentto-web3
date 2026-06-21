import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycConfig } from '../../config/configuration';
import { UploadFile } from './didit-api.service';

export interface ZenttoSessionResult {
  status?: string; // not_started | pending | in_review | approved | declined
  decision?: string | null;
  fullName?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  nationality?: string | null;
  birthDate?: string | null;
  mrzValid?: boolean;
  amlMatch?: boolean;
}

/**
 * Cliente de los APIs server-to-server del KYC NATIVO (zentto-kyc). NOSOTROS
 * capturamos las imágenes en la app y las subimos a la sesión; el servicio corre
 * OCR/MRZ + liveness + face-match (inference propio) y recalcula la decisión.
 * Auth por `X-API-Key: zkyc_...`. Reemplaza el flujo hospedado (no abre frontend).
 */
@Injectable()
export class ZenttoKycApiService {
  private readonly logger = new Logger(ZenttoKycApiService.name);
  private readonly cfg: KycConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<KycConfig>('kyc');
  }

  get enabled(): boolean {
    return !!this.cfg.zenttoKycApiKey;
  }

  private get base(): string {
    return this.cfg.zenttoKycBaseUrl;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { 'X-API-Key': this.cfg.zenttoKycApiKey, ...(extra ?? {}) };
  }

  private blob(f: UploadFile): Blob {
    return new Blob([new Uint8Array(f.buffer)], { type: f.mimetype });
  }

  private async postForm<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      this.logger.error(`Zentto KYC ${path} → ${res.status}: ${JSON.stringify(data)}`);
      throw new Error(`Zentto KYC ${path} respondió ${res.status}`);
    }
    return data as T;
  }

  /** Crea una sesión de verificación; devuelve su id (para enlazar los uploads). */
  async createSession(vendorData: string): Promise<string> {
    const body: Record<string, unknown> = this.cfg.zenttoKycWorkflowId
      ? { vendorData, workflowId: this.cfg.zenttoKycWorkflowId }
      : { vendorData, features: ['id', 'liveness', 'face_match'] };
    const res = await fetch(`${this.base}/v1/sessions`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { session?: { id?: string } };
    if (!res.ok || !data.session?.id) {
      throw new Error(`Zentto KYC create-session respondió ${res.status}`);
    }
    return data.session.id;
  }

  async idVerification(
    sessionId: string,
    front: UploadFile,
    back?: UploadFile,
    documentType?: string,
  ): Promise<void> {
    const form = new FormData();
    form.append('front_image', this.blob(front), front.originalname);
    if (back) form.append('back_image', this.blob(back), back.originalname);
    form.append('sessionId', sessionId);
    if (documentType) form.append('document_type', documentType);
    await this.postForm('/v1/documents/id-verification', form);
  }

  async liveness(sessionId: string, selfie: UploadFile): Promise<void> {
    const form = new FormData();
    form.append('image', this.blob(selfie), selfie.originalname);
    form.append('sessionId', sessionId);
    await this.postForm('/v1/biometrics/liveness', form);
  }

  async faceMatch(sessionId: string, selfie: UploadFile, frontDoc: UploadFile): Promise<void> {
    const form = new FormData();
    form.append('user_image', this.blob(selfie), selfie.originalname);
    form.append('ref_image', this.blob(frontDoc), frontDoc.originalname);
    form.append('sessionId', sessionId);
    await this.postForm('/v1/biometrics/face-match', form);
  }

  /** Lee el resultado/decisión de la sesión tras subir los datos. */
  async getSession(sessionId: string): Promise<ZenttoSessionResult> {
    const res = await fetch(`${this.base}/v1/sessions/${sessionId}`, { headers: this.headers() });
    const data = (await res.json().catch(() => ({}))) as { session?: ZenttoSessionResult };
    if (!res.ok || !data.session) {
      throw new Error(`Zentto KYC get-session respondió ${res.status}`);
    }
    return data.session;
  }
}

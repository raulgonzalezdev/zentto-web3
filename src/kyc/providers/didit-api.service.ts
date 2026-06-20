import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycConfig } from '../../config/configuration';

export interface UploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface IdVerificationResult {
  status?: string; // Approved | Declined | In Review
  first_name?: string;
  last_name?: string;
  document_type?: string;
  document_number?: string;
  date_of_birth?: string;
  nationality?: string;
  expiration_date?: string;
  warnings?: unknown[];
}

export interface ScoreResult {
  status?: string;
  score?: number;
}

export interface AmlApiResult {
  status?: string;
  total_hits?: number;
  hits?: unknown[];
  score?: number;
}

/**
 * Cliente de los **standalone APIs** de Didit (server-to-server, síncronos).
 * A diferencia de las sesiones (redirect + webhook), aquí NOSOTROS capturamos las
 * imágenes y Didit devuelve el resultado en el momento. No requiere workflow_id.
 * Auth por `x-api-key`. Cubre solo la parte adversarial; MRZ/OFAC siguen siendo nuestros.
 */
@Injectable()
export class DiditApiService {
  private readonly logger = new Logger(DiditApiService.name);
  private readonly cfg: KycConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<KycConfig>('kyc');
  }

  get enabled(): boolean {
    return !!this.cfg.diditApiKey;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { 'x-api-key': this.cfg.diditApiKey, ...(extra ?? {}) };
  }

  private blob(f: UploadFile): Blob {
    // Copia a Uint8Array para satisfacer BlobPart (Buffer usa ArrayBufferLike).
    return new Blob([new Uint8Array(f.buffer)], { type: f.mimetype });
  }

  private async postForm<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.cfg.diditBaseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(), // fetch añade el boundary multipart
      body: form,
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      this.logger.error(`Didit ${path} → ${res.status}: ${JSON.stringify(data)}`);
      throw new Error(`Didit ${path} respondió ${res.status}`);
    }
    return data as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.diditBaseUrl}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      this.logger.error(`Didit ${path} → ${res.status}: ${JSON.stringify(data)}`);
      throw new Error(`Didit ${path} respondió ${res.status}`);
    }
    return data as T;
  }

  /** Verificación de documento (autenticidad + OCR oficial). */
  async idVerification(
    front: UploadFile,
    back?: UploadFile,
    vendorData?: string,
  ): Promise<IdVerificationResult> {
    const form = new FormData();
    form.append('front_image', this.blob(front), front.originalname);
    if (back) form.append('back_image', this.blob(back), back.originalname);
    if (vendorData) form.append('vendor_data', vendorData);
    const r = await this.postForm<{ id_verification?: IdVerificationResult }>(
      '/v3/id-verification/',
      form,
    );
    return r.id_verification ?? {};
  }

  /** Liveness pasivo (¿es una persona real, no foto/video/máscara?). */
  async passiveLiveness(image: UploadFile): Promise<ScoreResult> {
    const form = new FormData();
    form.append('user_image', this.blob(image), image.originalname);
    const r = await this.postForm<{ passive_liveness?: ScoreResult }>(
      '/v3/passive-liveness/',
      form,
    );
    return r.passive_liveness ?? {};
  }

  /** Face match: ¿el selfie coincide con la foto del documento? */
  async faceMatch(userImage: UploadFile, refImage: UploadFile): Promise<ScoreResult> {
    const form = new FormData();
    form.append('user_image', this.blob(userImage), userImage.originalname);
    form.append('ref_image', this.blob(refImage), refImage.originalname);
    const r = await this.postForm<{ face_match?: ScoreResult }>('/v3/face-match/', form);
    return r.face_match ?? {};
  }

  /** AML profundo de Didit (listas globales + adverse media + monitoreo). */
  async aml(input: {
    fullName: string;
    dateOfBirth?: string;
    nationality?: string;
    documentNumber?: string;
  }): Promise<AmlApiResult> {
    const r = await this.postJson<{ aml?: AmlApiResult }>('/v3/aml/', {
      full_name: input.fullName,
      entity_type: 'person',
      date_of_birth: input.dateOfBirth,
      nationality: input.nationality,
      document_number: input.documentNumber,
      include_adverse_media: true,
    });
    return r.aml ?? {};
  }
}

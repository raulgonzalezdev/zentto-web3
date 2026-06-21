import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { KycConfig } from '../config/configuration';
import { KycStatus, KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { AmlScreeningService } from './aml-screening.service';
import { KycSubmitDto } from './dto/kyc.dto';
import { MrzService } from './mrz.service';
import { DiditApiService, UploadFile } from './providers/didit-api.service';
import { verifyDiditSignature } from './providers/didit-webhook.util';
import { DiditProvider } from './providers/didit.provider';
import { KycProvider } from './providers/kyc-provider';
import { ManualReviewProvider } from './providers/manual.provider';
import { ZenttoKycProvider } from './providers/zentto-kyc.provider';

export interface KycStatusView {
  id?: string;
  status: KycStatus;
  provider?: string;
  mrzValid?: boolean;
  amlMatch?: boolean;
  redirectUrl?: string | null;
  decisionReason?: string | null;
}

/**
 * Orquestador KYC (PROPIO). Combina lo construido en casa — OCR/MRZ + screening
 * OFAC — con un proveedor externo SOLO para liveness/autenticidad (vía adaptador).
 * Una verificación sancionada (AML hit) nunca se auto-aprueba: va a revisión.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly provider: KycProvider;
  private readonly cfg: KycConfig;

  constructor(
    @InjectRepository(KycVerificationEntity)
    private readonly repo: Repository<KycVerificationEntity>,
    private readonly mrz: MrzService,
    private readonly aml: AmlScreeningService,
    private readonly diditApi: DiditApiService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<KycConfig>('kyc');
    const didit = new DiditProvider({
      apiKey: this.cfg.diditApiKey,
      baseUrl: this.cfg.diditBaseUrl,
      workflowId: this.cfg.diditWorkflowId,
      callbackUrl: this.cfg.diditCallbackUrl,
    });
    // 'zentto-kyc' es el proveedor NATIVO (default); Didit queda como fallback.
    this.provider =
      this.cfg.provider === 'zentto-kyc'
        ? new ZenttoKycProvider(
            {
              apiKey: this.cfg.zenttoKycApiKey,
              baseUrl: this.cfg.zenttoKycBaseUrl,
              callbackUrl: this.cfg.zenttoKycCallbackUrl,
            },
            this.cfg.diditApiKey ? didit : undefined,
          )
        : this.cfg.provider === 'didit'
          ? didit
          : new ManualReviewProvider();
    this.logger.log(`Proveedor KYC de liveness: ${this.provider.name}`);
  }

  async getStatus(userId: string): Promise<KycStatusView> {
    const v = await this.repo.findOne({ where: { userId } });
    if (!v) return { status: 'not_started' };
    return {
      id: v.id,
      status: v.status,
      provider: v.provider,
      mrzValid: v.mrzValid,
      amlMatch: v.amlMatch,
      decisionReason: v.decisionReason,
    };
  }

  /** Cola de revisión para el operador (backoffice). */
  async listPending(): Promise<KycVerificationEntity[]> {
    return this.repo.find({
      where: [{ status: 'in_review' }, { status: 'pending' }],
      order: { createdAt: 'ASC' },
      take: 100,
    });
  }

  /**
   * Inicia una sesión hospedada de Didit (cámara con encuadre de documento +
   * óvalo de selfie + liveness). Devuelve la URL a abrir en la app; el resultado
   * llega por webhook y la app consulta GET /kyc/status.
   */
  async startSession(
    userId: string,
    fullName?: string,
  ): Promise<KycStatusView & { redirectUrl: string | null }> {
    const existing = await this.repo.findOne({ where: { userId } });
    if (existing && existing.status === 'approved') {
      throw new BadRequestException('Tu identidad ya está verificada');
    }
    const session = await this.provider.createSession({ userId, fullName: fullName ?? null });
    const entity =
      existing ?? this.repo.create({ id: randomUUID(), userId, status: 'not_started' });
    Object.assign(entity, {
      status: session.initialStatus,
      provider: this.provider.name,
      providerRef: session.ref,
      fullName: fullName ?? entity.fullName,
    });
    await this.repo.save(entity);
    return {
      id: entity.id,
      status: session.initialStatus,
      provider: this.provider.name,
      redirectUrl: session.redirectUrl,
    };
  }

  /** ¿El usuario está verificado? (gate para retiros/limites). */
  async isApproved(userId: string): Promise<boolean> {
    const v = await this.repo.findOne({ where: { userId } });
    return v?.status === 'approved';
  }

  async submit(userId: string, dto: KycSubmitDto): Promise<KycStatusView> {
    const existing = await this.repo.findOne({ where: { userId } });
    if (existing && existing.status === 'approved') {
      throw new BadRequestException('Tu identidad ya está verificada');
    }

    // 1) OCR/MRZ (nuestro): valida dígitos de control si viene MRZ.
    let mrzValid = false;
    let documentNumber = dto.documentNumber ?? null;
    let nationality: string | null = null;
    let birthDate: string | null = null;
    if (dto.mrz) {
      const r = this.mrz.parseTd3(dto.mrz);
      mrzValid = r.valid;
      if (r.fields) {
        documentNumber = r.fields.documentNumber || documentNumber;
        nationality = r.fields.nationality;
        birthDate = r.fields.birthDate;
      }
      if (!r.valid) this.logger.warn(`MRZ inválida para ${userId}: ${r.errors.join('; ')}`);
    }

    // 2) AML (nuestro): screening contra OFAC SDN.
    const aml = this.aml.screen(dto.fullName);

    // 3) Proveedor externo (solo liveness/autenticidad).
    const session = await this.provider.createSession({ userId, fullName: dto.fullName });

    // Un hit de sanciones jamás avanza automáticamente: a revisión.
    const status: KycStatus = aml.match ? 'in_review' : session.initialStatus;

    const entity =
      existing ?? this.repo.create({ id: randomUUID(), userId, status: 'not_started' });
    Object.assign(entity, {
      status,
      fullName: dto.fullName,
      documentType: dto.documentType,
      documentNumber,
      nationality,
      birthDate,
      mrzValid,
      amlMatch: aml.match,
      amlHits: aml.hits,
      provider: this.provider.name,
      providerRef: session.ref,
      decisionReason: null,
      reviewedBy: null,
    });
    await this.repo.save(entity);

    return {
      id: entity.id,
      status,
      provider: this.provider.name,
      mrzValid,
      amlMatch: aml.match,
      redirectUrl: session.redirectUrl,
    };
  }

  /**
   * Verificación server-to-server (standalone APIs de Didit): NOSOTROS capturamos
   * las imágenes y Didit resuelve la parte adversarial de forma SÍNCRONA.
   * Combina id-verification + liveness + face-match (Didit) con OFAC (nuestro).
   */
  async verifyWithDocuments(
    userId: string,
    files: { front?: UploadFile; back?: UploadFile; selfie?: UploadFile },
    fullNameInput?: string,
  ): Promise<KycStatusView> {
    if (!this.diditApi.enabled) {
      throw new BadRequestException(
        'Verificación con Didit no configurada (DIDIT_API_KEY ausente)',
      );
    }
    if (!files.front) throw new BadRequestException('front_image es obligatoria');
    const existing = await this.repo.findOne({ where: { userId } });
    if (existing && existing.status === 'approved') {
      throw new BadRequestException('Tu identidad ya está verificada');
    }

    const isApproved = (s?: string) => s === 'Approved';
    const isDeclined = (s?: string) => s === 'Declined';

    const entity =
      existing ?? this.repo.create({ id: randomUUID(), userId, status: 'not_started' });
    try {
      const id = await this.diditApi.idVerification(files.front, files.back, userId);
      let liveOk = true;
      let faceOk = true;
      let declinedBiometrics = false;
      if (files.selfie) {
        const [live, face] = await Promise.all([
          this.diditApi.passiveLiveness(files.selfie),
          this.diditApi.faceMatch(files.selfie, files.front),
        ]);
        liveOk = isApproved(live.status);
        faceOk = isApproved(face.status);
        declinedBiometrics = isDeclined(live.status) || isDeclined(face.status);
        entity.livenessPassed = liveOk;
      }

      const fullName = (fullNameInput ?? `${id.first_name ?? ''} ${id.last_name ?? ''}`).trim();
      const ofac = this.aml.screen(fullName);

      const declined = isDeclined(id.status) || declinedBiometrics;
      const allApproved = isApproved(id.status) && liveOk && faceOk;
      const status: KycStatus = declined
        ? 'rejected'
        : allApproved && !ofac.match
          ? 'approved'
          : 'in_review';

      Object.assign(entity, {
        status,
        fullName: fullName || entity.fullName,
        documentType: id.document_type ?? entity.documentType,
        documentNumber: id.document_number ?? entity.documentNumber,
        nationality: id.nationality ?? entity.nationality,
        birthDate: id.date_of_birth ?? entity.birthDate,
        amlMatch: ofac.match,
        amlHits: ofac.hits,
        provider: 'didit',
        decisionReason: declined ? 'Documento o biometría rechazados por Didit' : null,
      });
      await this.repo.save(entity);
      return { id: entity.id, status, provider: 'didit', amlMatch: ofac.match };
    } catch (err) {
      // Si Didit falla, no rechazamos: a revisión manual con el motivo.
      this.logger.error(`verifyWithDocuments error: ${(err as Error).message}`);
      Object.assign(entity, {
        status: 'in_review',
        provider: 'didit',
        decisionReason: `Error del proveedor: ${(err as Error).message}`,
      });
      await this.repo.save(entity);
      return { id: entity.id, status: 'in_review', provider: 'didit' };
    }
  }

  /**
   * Webhook de Didit: verifica la firma HMAC y aplica el resultado de liveness.
   * `vendor_data` es nuestro userId. Idempotente: re-procesa sin efectos extra.
   */
  async handleDiditWebhook(
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: boolean }> {
    if (!verifyDiditSignature(body, headers, this.cfg.diditWebhookSecret)) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }
    const userId = String(body.vendor_data ?? '');
    const diditStatus = String(body.status ?? '');
    const v = await this.repo.findOne({ where: { userId } });
    if (!v) {
      this.logger.warn(`Webhook Didit para usuario desconocido: ${userId}`);
      return { ok: true }; // ack para que Didit no reintente
    }
    const map: Record<string, KycStatus> = {
      Approved: 'approved',
      Declined: 'rejected',
      'In Review': 'in_review',
      'Not Started': 'pending',
      'In Progress': 'pending',
    };
    const next = map[diditStatus];
    if (next) {
      v.status = next;
      v.livenessPassed =
        next === 'approved' ? true : next === 'rejected' ? false : v.livenessPassed;
      v.providerRef = String(body.session_id ?? v.providerRef ?? '');
      await this.repo.save(v);
      this.logger.log(`KYC ${v.id} → ${next} (Didit: ${diditStatus})`);
    }
    return { ok: true };
  }

  /**
   * Webhook del KYC NATIVO (zentto-kyc): verifica la firma HMAC-SHA256 sobre el
   * body crudo (`${createdAt}.${rawBody}`) y aplica el resultado. Mapea por la
   * sesión (providerRef). Idempotente.
   */
  async handleZenttoWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: boolean }> {
    const secret = this.cfg.zenttoKycWebhookSecret;
    if (!secret) throw new UnauthorizedException('Webhook KYC sin secreto configurado');
    const sig = String(headers['x-zentto-signature'] ?? '');
    const createdAt = String(headers['x-zentto-created-at'] ?? '');
    const canonical = `${createdAt}.${rawBody.toString('utf8')}`;
    const expected = createHmac('sha256', secret).update(canonical).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const body = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      data?: { sessionId?: string; decision?: string; reason?: string };
    };
    const sessionId = String(body.data?.sessionId ?? '');
    const decision = String(body.data?.decision ?? '');
    const v = await this.repo.findOne({ where: { providerRef: sessionId } });
    if (!v) {
      this.logger.warn(`Webhook Zentto KYC para sesión desconocida: ${sessionId}`);
      return { ok: true };
    }
    const map: Record<string, KycStatus> = {
      approved: 'approved',
      declined: 'rejected',
      in_review: 'in_review',
    };
    const next = map[decision];
    if (next) {
      v.status = next;
      v.livenessPassed =
        next === 'approved' ? true : next === 'rejected' ? false : v.livenessPassed;
      if (body.data?.reason) v.decisionReason = body.data.reason;
      await this.repo.save(v);
      this.logger.log(`KYC ${v.id} → ${next} (Zentto KYC: ${decision})`);
    }
    return { ok: true };
  }

  /** Decisión del operador (backoffice). Aprueba/rechaza una verificación en revisión. */
  async decide(
    verificationId: string,
    approve: boolean,
    reviewerId: string,
    reason?: string,
  ): Promise<KycStatusView> {
    const v = await this.repo.findOne({ where: { id: verificationId } });
    if (!v) throw new NotFoundException('Verificación no encontrada');
    v.status = approve ? 'approved' : 'rejected';
    v.decisionReason = reason ?? null;
    v.reviewedBy = reviewerId;
    if (approve) v.livenessPassed = true;
    await this.repo.save(v);
    return { status: v.status, provider: v.provider, decisionReason: v.decisionReason };
  }
}

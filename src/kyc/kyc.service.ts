import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { KycConfig } from '../config/configuration';
import { KycStatus, KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { AmlScreeningService } from './aml-screening.service';
import { KycSubmitDto } from './dto/kyc.dto';
import { MrzService } from './mrz.service';
import { DiditProvider } from './providers/didit.provider';
import { KycProvider } from './providers/kyc-provider';
import { ManualReviewProvider } from './providers/manual.provider';

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

  constructor(
    @InjectRepository(KycVerificationEntity)
    private readonly repo: Repository<KycVerificationEntity>,
    private readonly mrz: MrzService,
    private readonly aml: AmlScreeningService,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<KycConfig>('kyc');
    this.provider =
      cfg.provider === 'didit' ? new DiditProvider(cfg.diditApiKey) : new ManualReviewProvider();
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

import { Injectable } from '@nestjs/common';
import { AiReportService, ComplianceNarrative } from './ai-report.service';
import { RiskAssessment, RiskScoringService } from './risk-scoring.service';

export interface ComplianceReport {
  assessment: RiskAssessment;
  report: ComplianceNarrative;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly riskScoring: RiskScoringService,
    private readonly aiReport: AiReportService,
  ) {}

  /** Screening rápido: solo el scoring de riesgo (sin narrativa). */
  async screen(address: string): Promise<RiskAssessment> {
    return this.riskScoring.assess(address);
  }

  /** Informe completo: scoring + narrativa (IA o determinista). */
  async report(address: string): Promise<ComplianceReport> {
    const assessment = await this.riskScoring.assess(address);
    const report = await this.aiReport.generate(assessment);
    return { assessment, report };
  }

  aiStatus() {
    return { aiEnabled: this.aiReport.aiEnabled };
  }
}

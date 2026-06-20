import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiConfig } from '../config/configuration';
import { RiskAssessment } from './risk-scoring.service';

export interface ComplianceNarrative {
  generatedBy: 'anthropic' | 'deterministic';
  model?: string;
  summary: string;
  recommendation: string;
  narrative: string;
}

/**
 * Genera la parte narrativa del informe de cumplimiento.
 *
 * Si hay ANTHROPIC_API_KEY configurada usa Claude (claude-opus-4-8 por defecto)
 * con adaptive thinking + streaming para redactar un informe profesional. Si no,
 * cae a un generador determinista basado en plantillas — el servicio funciona
 * 100% sin clave de IA (útil para CI, demos y entornos air-gapped).
 */
@Injectable()
export class AiReportService {
  private readonly logger = new Logger(AiReportService.name);
  private readonly ai: AiConfig;
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
    this.ai = config.getOrThrow<AiConfig>('ai');
    this.client = this.ai.apiKey ? new Anthropic({ apiKey: this.ai.apiKey }) : null;
  }

  get aiEnabled(): boolean {
    return this.client !== null;
  }

  async generate(assessment: RiskAssessment): Promise<ComplianceNarrative> {
    if (this.client) {
      try {
        return await this.generateWithAnthropic(assessment, this.client);
      } catch (err) {
        this.logger.warn(
          `Fallo al generar informe con IA, usando generador determinista: ${(err as Error).message}`,
        );
      }
    }
    return this.generateDeterministic(assessment);
  }

  // ───────────────────────── Claude (Anthropic) ─────────────────────────

  private async generateWithAnthropic(
    assessment: RiskAssessment,
    client: Anthropic,
  ): Promise<ComplianceNarrative> {
    const system =
      'Eres un analista senior de cumplimiento normativo (AML/CFT) en una plataforma Web3. ' +
      'Redactas informes de screening claros, objetivos y accionables para un equipo de ' +
      'cumplimiento. No inventas datos: te basas únicamente en las señales y métricas provistas. ' +
      'Respondes en español, en tono profesional y conciso.';

    const userContent =
      'Genera un informe de cumplimiento para la siguiente evaluación de riesgo de una address ' +
      'on-chain. Estructura la respuesta en tres secciones con estos encabezados exactos:\n' +
      '## Resumen\n## Recomendación\n## Análisis detallado\n\n' +
      'Datos de la evaluación (JSON):\n```json\n' +
      JSON.stringify(assessment, null, 2) +
      '\n```';

    // Parámetros recomendados por la guía de la API de Claude: adaptive thinking +
    // effort + streaming. Se castea a any para tolerar variaciones de tipos del SDK.
    const params: any = {
      model: this.ai.model,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.ai.effort },
      system,
      messages: [{ role: 'user', content: userContent }],
    };

    const stream = client.messages.stream(params);
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();

    return {
      generatedBy: 'anthropic',
      model: this.ai.model,
      summary: this.extractSection(text, 'Resumen') ?? text.slice(0, 280),
      recommendation: this.extractSection(text, 'Recomendación') ?? '',
      narrative: text,
    };
  }

  private extractSection(text: string, header: string): string | null {
    const regex = new RegExp(`##\\s*${header}\\s*\\n([\\s\\S]*?)(?:\\n##\\s|$)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  // ───────────────────────── Determinista (offline) ─────────────────────────

  private generateDeterministic(assessment: RiskAssessment): ComplianceNarrative {
    const { riskLevel, score, signals, metrics, address } = assessment;

    const recommendationByLevel: Record<RiskAssessment['riskLevel'], string> = {
      high:
        'Aplicar Enhanced Due Diligence (EDD), congelar operaciones pendientes de revisión y ' +
        'evaluar la presentación de un Reporte de Operación Sospechosa (SAR) ante la unidad ' +
        'de inteligencia financiera correspondiente.',
      medium:
        'Mantener monitoreo reforzado, solicitar información adicional sobre el origen de fondos ' +
        '(KYC/source-of-funds) y reevaluar tras nuevas operaciones.',
      low: 'Riesgo dentro de parámetros normales. Continuar con monitoreo estándar.',
    };

    const signalLines = signals.length
      ? signals
          .map((s) => `- [${s.severity.toUpperCase()}] ${s.label}: ${s.detail} (+${s.weight})`)
          .join('\n')
      : '- No se detectaron señales de alerta.';

    const summary =
      `La address ${address} presenta un nivel de riesgo ${riskLevel.toUpperCase()} ` +
      `(score ${score}/100) tras analizar ${metrics.transactionCount} transacciones, ` +
      `${metrics.uniqueCounterparties} contrapartes únicas y un volumen recibido de ${metrics.totalReceived}.`;

    const recommendation = recommendationByLevel[riskLevel];

    const narrative =
      `## Resumen\n${summary}\n\n` +
      `## Recomendación\n${recommendation}\n\n` +
      `## Análisis detallado\n` +
      `Señales detectadas:\n${signalLines}\n\n` +
      `Métricas on-chain:\n` +
      `- Transacciones: ${metrics.transactionCount}\n` +
      `- Total recibido: ${metrics.totalReceived}\n` +
      `- Total enviado: ${metrics.totalSent}\n` +
      `- Transferencia mayor: ${metrics.largestTransfer}\n` +
      `- Contrapartes únicas: ${metrics.uniqueCounterparties}\n`;

    return { generatedBy: 'deterministic', summary, recommendation, narrative };
  }
}

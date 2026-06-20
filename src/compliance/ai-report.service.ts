import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Agent, fetch as undiciFetch } from 'undici';
import { AiConfig } from '../config/configuration';
import { RiskAssessment } from './risk-scoring.service';

/**
 * `fetch` con keep-alive deshabilitado. Evita el error "Premature close" de
 * undici al reutilizar conexiones que el servidor (DeepSeek/OpenAI) cierra.
 */
const noKeepAliveDispatcher = new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });
// `any` a propósito: el tipo de undici.fetch no coincide exactamente con el
// tipo `Fetch` del SDK de OpenAI (ts-jest lo rechaza); en runtime es compatible.
const resilientFetch: any = (url: any, init?: any) =>
  undiciFetch(url, { ...init, dispatcher: noKeepAliveDispatcher });

export type NarrativeSource = 'anthropic' | 'openai' | 'deepseek' | 'deterministic';

export interface ComplianceNarrative {
  generatedBy: NarrativeSource;
  model?: string;
  summary: string;
  recommendation: string;
  narrative: string;
}

type EffectiveProvider = 'anthropic' | 'openai' | 'deepseek' | null;

/**
 * Genera la parte narrativa del informe de cumplimiento. Soporta múltiples
 * proveedores de IA y un generador determinista de respaldo:
 *
 * - anthropic        → Claude (claude-opus-4-8) con adaptive thinking + streaming.
 * - openai / deepseek → API compatible OpenAI (gpt-4o-mini / deepseek-chat).
 * - sin key          → generador determinista basado en plantillas.
 *
 * El proveedor se resuelve por `AI_PROVIDER` (o 'auto' según las keys presentes).
 * El servicio es 100% funcional sin ninguna key (CI, demos, air-gapped).
 */
@Injectable()
export class AiReportService {
  private readonly logger = new Logger(AiReportService.name);
  private readonly ai: AiConfig;
  private readonly provider: EffectiveProvider;
  private readonly anthropic: Anthropic | null = null;
  private readonly openai: OpenAI | null = null;

  constructor(config: ConfigService) {
    this.ai = config.getOrThrow<AiConfig>('ai');
    this.provider = this.resolveProvider();

    if (this.provider === 'anthropic') {
      this.anthropic = new Anthropic({ apiKey: this.ai.anthropicApiKey });
    } else if (this.provider === 'openai' || this.provider === 'deepseek') {
      this.openai = new OpenAI({
        apiKey: this.ai.openaiApiKey,
        baseURL: this.baseUrlFor(this.provider),
        fetch: resilientFetch,
        maxRetries: 3,
      });
    }

    this.logger.log(`Proveedor de IA para informes: ${this.provider ?? 'deterministic'}`);
  }

  get aiEnabled(): boolean {
    return this.provider !== null;
  }

  /** Resuelve el proveedor efectivo según AI_PROVIDER y las keys disponibles. */
  private resolveProvider(): EffectiveProvider {
    const { provider, anthropicApiKey, openaiApiKey, openaiBaseUrl } = this.ai;

    if (provider === 'none') return null;
    if (provider === 'anthropic') return anthropicApiKey ? 'anthropic' : null;
    if (provider === 'openai') return openaiApiKey ? 'openai' : null;
    if (provider === 'deepseek') return openaiApiKey ? 'deepseek' : null;

    // auto: prioriza Anthropic, luego compatible OpenAI (detecta DeepSeek por la URL).
    if (anthropicApiKey) return 'anthropic';
    if (openaiApiKey) return openaiBaseUrl.includes('deepseek') ? 'deepseek' : 'openai';
    return null;
  }

  private baseUrlFor(provider: 'openai' | 'deepseek'): string {
    if (provider === 'deepseek') {
      // Si el usuario no sobrescribió la URL openai por defecto, usa la de DeepSeek.
      return this.ai.openaiBaseUrl.includes('openai.com')
        ? 'https://api.deepseek.com/v1'
        : this.ai.openaiBaseUrl;
    }
    return this.ai.openaiBaseUrl;
  }

  private modelFor(provider: 'anthropic' | 'openai' | 'deepseek'): string {
    if (this.ai.model) return this.ai.model;
    if (provider === 'anthropic') return 'claude-opus-4-8';
    if (provider === 'deepseek') return 'deepseek-chat';
    return 'gpt-4o-mini';
  }

  async generate(assessment: RiskAssessment): Promise<ComplianceNarrative> {
    try {
      if (this.provider === 'anthropic' && this.anthropic) {
        return await this.generateWithAnthropic(assessment, this.anthropic);
      }
      if ((this.provider === 'openai' || this.provider === 'deepseek') && this.openai) {
        return await this.generateWithOpenAI(assessment, this.openai, this.provider);
      }
    } catch (err) {
      this.logger.warn(
        `Fallo al generar informe con IA (${this.provider}), usando generador determinista: ${
          (err as Error).message
        }`,
      );
    }
    return this.generateDeterministic(assessment);
  }

  // ───────────────────────── Prompts compartidos ─────────────────────────

  private systemPrompt(): string {
    return (
      'Eres un analista senior de cumplimiento normativo (AML/CFT) en una plataforma Web3. ' +
      'Redactas informes de screening claros, objetivos y accionables para un equipo de ' +
      'cumplimiento. No inventas datos: te basas únicamente en las señales y métricas provistas. ' +
      'Respondes en español, en tono profesional y conciso.'
    );
  }

  private userPrompt(assessment: RiskAssessment): string {
    return (
      'Genera un informe de cumplimiento para la siguiente evaluación de riesgo de una address ' +
      'on-chain. Estructura la respuesta en tres secciones con estos encabezados exactos:\n' +
      '## Resumen\n## Recomendación\n## Análisis detallado\n\n' +
      'Datos de la evaluación (JSON):\n```json\n' +
      JSON.stringify(assessment, null, 2) +
      '\n```'
    );
  }

  // ───────────────────────── Claude (Anthropic) ─────────────────────────

  private async generateWithAnthropic(
    assessment: RiskAssessment,
    client: Anthropic,
  ): Promise<ComplianceNarrative> {
    const model = this.modelFor('anthropic');
    // adaptive thinking + effort + streaming (recomendado por la guía de la API de Claude).
    const params: any = {
      model,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      output_config: { effort: this.ai.effort },
      system: this.systemPrompt(),
      messages: [{ role: 'user', content: this.userPrompt(assessment) }],
    };

    const stream = client.messages.stream(params);
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();

    return this.toNarrative('anthropic', model, text);
  }

  // ─────────────────── Compatible OpenAI (OpenAI / DeepSeek) ───────────────────

  private async generateWithOpenAI(
    assessment: RiskAssessment,
    client: OpenAI,
    provider: 'openai' | 'deepseek',
  ): Promise<ComplianceNarrative> {
    const model = this.modelFor(provider);
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: this.userPrompt(assessment) },
      ],
    });
    const text = (completion.choices[0]?.message?.content ?? '').trim();
    return this.toNarrative(provider, model, text);
  }

  private toNarrative(source: NarrativeSource, model: string, text: string): ComplianceNarrative {
    return {
      generatedBy: source,
      model,
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

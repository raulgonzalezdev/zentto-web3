import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockchainService } from '../blockchain/blockchain.service';
import { AmlConfig } from '../config/configuration';

export interface RiskSignal {
  code: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
  weight: number;
  detail: string;
}

export interface AddressMetrics {
  transactionCount: number;
  totalReceived: number;
  totalSent: number;
  uniqueCounterparties: number;
  largestTransfer: number;
  firstSeen: number | null;
  lastSeen: number | null;
}

export interface RiskAssessment {
  address: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high';
  signals: RiskSignal[];
  metrics: AddressMetrics;
  assessedAt: string;
}

/**
 * Motor de scoring AML basado en heurísticas sobre el histórico on-chain de una
 * address. Detecta patrones típicos de lavado: structuring (smurfing), alta
 * velocidad, pass-through (cuentas mula) y dispersión a muchas contrapartes.
 *
 * Determinista y explicable: cada punto del score proviene de una señal
 * concreta y auditable (clave para informes de cumplimiento).
 */
@Injectable()
export class RiskScoringService {
  private readonly aml: AmlConfig;

  constructor(
    private readonly blockchain: BlockchainService,
    config: ConfigService,
  ) {
    this.aml = config.getOrThrow<AmlConfig>('aml');
  }

  async assess(address: string): Promise<RiskAssessment> {
    const txs = await this.blockchain.getAddressTransactions(address);
    const signals: RiskSignal[] = [];

    const incoming = txs.filter((t) => t.toAddress === address);
    const outgoing = txs.filter((t) => t.fromAddress === address);

    const totalReceived = incoming.reduce((a, t) => a + Number(t.amount), 0);
    const totalSent = outgoing.reduce((a, t) => a + Number(t.amount), 0);
    const counterparties = new Set<string>();
    txs.forEach((t) => {
      if (t.fromAddress && t.fromAddress !== address) counterparties.add(t.fromAddress);
      if (t.toAddress !== address) counterparties.add(t.toAddress);
    });
    const timestamps = txs.map((t) => Number(t.timestamp));
    const largestTransfer = txs.reduce((m, t) => Math.max(m, Number(t.amount)), 0);

    const metrics: AddressMetrics = {
      transactionCount: txs.length,
      totalReceived,
      totalSent,
      uniqueCounterparties: counterparties.size,
      largestTransfer,
      firstSeen: timestamps.length ? Math.min(...timestamps) : null,
      lastSeen: timestamps.length ? Math.max(...timestamps) : null,
    };

    // ── Señal 1: alta velocidad (≥10 tx en una ventana de 1h) ──
    const velocity = this.maxTxInWindow(timestamps, 60 * 60 * 1000);
    if (velocity >= 10) {
      signals.push({
        code: 'HIGH_VELOCITY',
        label: 'Alta velocidad transaccional',
        severity: 'medium',
        weight: 25,
        detail: `${velocity} transacciones dentro de una ventana de 1 hora`,
      });
    }

    // ── Señal 2: structuring / smurfing (varias salidas justo bajo el umbral) ──
    const threshold = this.aml.structuringAmount;
    const nearThreshold = outgoing.filter(
      (t) => Number(t.amount) >= threshold * 0.9 && Number(t.amount) < threshold,
    );
    if (nearThreshold.length >= 3) {
      signals.push({
        code: 'STRUCTURING',
        label: 'Posible structuring (smurfing)',
        severity: 'high',
        weight: 35,
        detail: `${nearThreshold.length} transferencias entre ${(threshold * 0.9).toFixed(
          0,
        )} y ${threshold} (justo bajo el umbral de reporte)`,
      });
    }

    // ── Señal 3: pass-through / cuenta mula (recibe y reenvía casi todo) ──
    if (
      totalReceived > 0 &&
      totalSent / totalReceived >= 0.9 &&
      incoming.length > 0 &&
      outgoing.length > 0
    ) {
      signals.push({
        code: 'PASS_THROUGH',
        label: 'Patrón pass-through (cuenta mula)',
        severity: 'high',
        weight: 25,
        detail: `Reenvía el ${((totalSent / totalReceived) * 100).toFixed(0)}% de lo recibido`,
      });
    }

    // ── Señal 4: alta dispersión (fan-out a muchas contrapartes) ──
    const outCounterparties = new Set(outgoing.map((t) => t.toAddress));
    if (outCounterparties.size >= 20) {
      signals.push({
        code: 'HIGH_FANOUT',
        label: 'Dispersión a muchas contrapartes',
        severity: 'medium',
        weight: 20,
        detail: `Envíos a ${outCounterparties.size} addresses distintas`,
      });
    }

    // ── Señal 5: transferencia de alto valor ──
    if (largestTransfer >= 100_000) {
      signals.push({
        code: 'LARGE_TRANSFER',
        label: 'Transferencia de alto valor',
        severity: 'medium',
        weight: 20,
        detail: `Transferencia individual de ${largestTransfer}`,
      });
    }

    const score = Math.min(
      100,
      signals.reduce((acc, s) => acc + s.weight, 0),
    );
    const riskLevel = this.toRiskLevel(score);

    return {
      address,
      score,
      riskLevel,
      signals,
      metrics,
      assessedAt: new Date().toISOString(),
    };
  }

  private toRiskLevel(score: number): 'low' | 'medium' | 'high' {
    if (score >= this.aml.highRiskThreshold) return 'high';
    if (score >= Math.floor(this.aml.highRiskThreshold / 2)) return 'medium';
    return 'low';
  }

  /** Máximo número de timestamps que caben en una ventana deslizante de `windowMs`. */
  private maxTxInWindow(timestamps: number[], windowMs: number): number {
    if (timestamps.length === 0) return 0;
    const sorted = [...timestamps].sort((a, b) => a - b);
    let max = 1;
    let start = 0;
    for (let end = 0; end < sorted.length; end++) {
      while (sorted[end] - sorted[start] > windowMs) start++;
      max = Math.max(max, end - start + 1);
    }
    return max;
  }
}

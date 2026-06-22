import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from '../database/entities/app-setting.entity';

export type SettingType = 'percent' | 'number' | 'bool' | 'string';

export interface SettingDef {
  key: string;
  group: string; // módulo: 'fees', 'withdrawals', 'sweep', ...
  label: string;
  type: SettingType;
  description?: string;
  /** Rango para validar números/porcentajes. */
  min?: number;
  max?: number;
}

/**
 * REGISTRO de parámetros configurables desde el backoffice. Añadir una entrada
 * aquí + leerla con `getNumber/getBool/getString(key, default)` en el servicio
 * correspondiente la vuelve editable en runtime, con el `.env` como default.
 */
export const SETTINGS_REGISTRY: SettingDef[] = [
  // ── Fees / Tesorería ──
  { key: 'fee.p2pPct', group: 'fees', label: 'Comisión P2P', type: 'percent', min: 0, max: 0.2, description: 'Fracción sobre el cripto liberado (0.005 = 0.5%).' },
  { key: 'fee.depositPct', group: 'fees', label: 'Comisión depósito', type: 'percent', min: 0, max: 0.2, description: 'Fracción sobre cada recarga/depósito on-chain.' },
  { key: 'fee.withdrawPct', group: 'fees', label: 'Comisión retiro', type: 'percent', min: 0, max: 0.2, description: 'Fracción de plataforma sobre cada retiro.' },
  { key: 'fee.withdrawNetworkFee', group: 'fees', label: 'Fee de red (retiro)', type: 'number', min: 0, max: 100, description: 'Gas fijo cobrado por retiro, en el asset.' },
  { key: 'fee.minFee', group: 'fees', label: 'Fee mínimo', type: 'number', min: 0, max: 100, description: 'Piso de comisión por operación.' },
  // ── Sweep / barrido ──
  { key: 'sweep.minToken', group: 'sweep', label: 'Umbral mínimo de barrido', type: 'number', min: 0, max: 1000, description: 'Saldo mínimo de token para barrer una dirección.' },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(
    @InjectRepository(AppSettingEntity)
    private readonly repo: Repository<AppSettingEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((r) => [r.key, r.value]));
  }

  getNumber(key: string, fallback: number): number {
    const v = this.cache.get(key);
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  getBool(key: string, fallback: boolean): boolean {
    const v = this.cache.get(key);
    if (v === undefined) return fallback;
    return v === 'true' || v === '1';
  }

  getString(key: string, fallback: string): string {
    return this.cache.get(key) ?? fallback;
  }

  /** Lista la definición + valor actual (override) de cada parámetro configurable. */
  list(): Array<SettingDef & { value: string | null }> {
    return SETTINGS_REGISTRY.map((d) => ({ ...d, value: this.cache.get(d.key) ?? null }));
  }

  /** Actualiza un parámetro (validado contra el registro). */
  async set(key: string, value: string, updatedBy?: string): Promise<void> {
    const def = SETTINGS_REGISTRY.find((d) => d.key === key);
    if (!def) throw new BadRequestException(`Parámetro no configurable: ${key}`);
    const normalized = this.validate(def, value);
    await this.repo.save({ key, value: normalized, updatedBy: updatedBy ?? null });
    this.cache.set(key, normalized);
  }

  private validate(def: SettingDef, raw: string): string {
    if (def.type === 'bool') {
      const b = raw === 'true' || raw === '1';
      return b ? 'true' : 'false';
    }
    if (def.type === 'string') return raw.slice(0, 500);
    // number / percent
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new BadRequestException(`${def.key}: debe ser numérico`);
    if (typeof def.min === 'number' && n < def.min)
      throw new BadRequestException(`${def.key}: mínimo ${def.min}`);
    if (typeof def.max === 'number' && n > def.max)
      throw new BadRequestException(`${def.key}: máximo ${def.max}`);
    return String(n);
  }
}

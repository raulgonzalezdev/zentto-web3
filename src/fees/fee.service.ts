import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeesConfig } from '../config/configuration';
import { addStr, cmpStr, fromBase, subStr, toBase } from '../common/money.util';

/** Cuenta maestra de tesorería donde se acumulan las comisiones de plataforma. */
export const FEE_ACCOUNT = 'fees';

export interface FeeQuote {
  /** Comisión de plataforma (nuestro ingreso). */
  platformFee: string;
  /** Comisión de red (gas) — solo retiros. */
  networkFee: string;
  /** Comisión total cobrada (plataforma + red). */
  totalFee: string;
  /** Neto que recibe el usuario (operaciones de entrada/liberación). */
  net: string;
  /** Total que paga el usuario (operaciones de salida/retiro). */
  total: string;
}

/**
 * Calcula las comisiones de plataforma (modelo de negocio, estilo Binance). Un
 * pequeño % por operación se cobra a favor de la cuenta maestra de tesorería
 * (`system/fees`). Todo se expone de forma transparente al usuario.
 */
@Injectable()
export class FeeService {
  private readonly cfg: FeesConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<FeesConfig>('fees');
  }

  get rates(): FeesConfig {
    return this.cfg;
  }

  /** fee = amount * pct (aritmética exacta en base 1e18), con piso `minFee`. */
  private percent(amount: string, pct: number): string {
    const feeBase = (toBase(amount) * toBase(pct.toString())) / 10n ** 18n;
    let fee = fromBase(feeBase);
    if (cmpStr(fee, String(this.cfg.minFee)) < 0) fee = String(this.cfg.minFee);
    // Nunca cobrar más que el propio monto.
    if (cmpStr(fee, amount) > 0) fee = amount;
    return fee;
  }

  /** P2P: comisión sobre el cripto liberado; el comprador recibe el neto. */
  quoteP2p(amount: string): FeeQuote {
    const platformFee = this.percent(amount, this.cfg.p2pPct);
    return {
      platformFee,
      networkFee: '0',
      totalFee: platformFee,
      net: subStr(amount, platformFee),
      total: amount,
    };
  }

  /** Recarga/depósito: comisión sobre lo acreditado; el usuario recibe el neto. */
  quoteDeposit(amount: string): FeeQuote {
    const platformFee = this.percent(amount, this.cfg.depositPct);
    return {
      platformFee,
      networkFee: '0',
      totalFee: platformFee,
      net: subStr(amount, platformFee),
      total: amount,
    };
  }

  /** Retiro: comisión de plataforma + comisión de red; el usuario paga el total. */
  quoteWithdraw(amount: string): FeeQuote {
    const platformFee = this.percent(amount, this.cfg.withdrawPct);
    const networkFee = String(this.cfg.withdrawNetworkFee);
    const totalFee = addStr(platformFee, networkFee);
    return {
      platformFee,
      networkFee,
      totalFee,
      net: amount, // lo que se envía on-chain
      total: addStr(amount, totalFee),
    };
  }
}

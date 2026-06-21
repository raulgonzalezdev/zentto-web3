import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { BinancePayConfig } from '../config/configuration';

/**
 * Cliente de Binance Pay (comerciante entidad). Firma HMAC-SHA512 según el esquema
 * oficial: payload = `${timestamp}\n${nonce}\n${body}\n`, firma en HEX MAYÚSCULAS,
 * en el header BinancePay-Signature. Si faltan credenciales, lanza 503 (gated).
 *
 * Endpoints usados:
 *  - Crear orden C2B (recargar desde Binance): /binancepay/openapi/v3/order
 *  - Payout B2C (retirar a Binance por ID/correo): /binancepay/openapi/payout/transfer
 */
@Injectable()
export class BinancePayService {
  private readonly logger = new Logger(BinancePayService.name);
  private readonly cfg: BinancePayConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<BinancePayConfig>('binancePay');
  }

  get enabled(): boolean {
    return !!(this.cfg.merchantId && this.cfg.apiKey && this.cfg.apiSecret);
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Binance Pay no configurado (faltan credenciales de comerciante)',
      );
    }
  }

  /** Llamada firmada a la API de Binance Pay. */
  private async signedRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
    this.assertEnabled();
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString('hex');
    const payloadBody = JSON.stringify(body);
    const toSign = `${timestamp}\n${nonce}\n${payloadBody}\n`;
    const signature = createHmac('sha512', this.cfg.apiSecret)
      .update(toSign)
      .digest('hex')
      .toUpperCase();

    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'BinancePay-Timestamp': timestamp,
        'BinancePay-Nonce': nonce,
        'BinancePay-Certificate-SN': this.cfg.apiKey,
        'BinancePay-Signature': signature,
      },
      body: payloadBody,
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; code?: string };
    if (!res.ok || (json.status && json.status !== 'SUCCESS')) {
      throw new ServiceUnavailableException(
        `Binance Pay ${path}: ${json.code ?? res.status} ${json.status ?? ''}`.trim(),
      );
    }
    return json as T;
  }

  /**
   * Crea una orden C2B: el usuario paga desde su saldo Binance. Devuelve los datos
   * de checkout (deeplink/QR) y el prepayId. La acreditación ocurre por webhook.
   */
  async createOrder(input: {
    merchantTradeNo: string;
    amount: string;
    currency: string; // p.ej. 'USDT'
    goods: string;
  }): Promise<{ prepayId: string; checkoutUrl?: string; deeplink?: string; qrContent?: string }> {
    const data = await this.signedRequest<{
      data?: {
        prepayId: string;
        checkoutUrl?: string;
        deeplink?: string;
        qrContent?: string;
        universalUrl?: string;
      };
    }>('/binancepay/openapi/v3/order', {
      env: { terminalType: 'APP' },
      merchantTradeNo: input.merchantTradeNo,
      orderAmount: input.amount,
      currency: input.currency,
      goods: {
        goodsType: '02',
        goodsCategory: 'Z000',
        referenceGoodsId: input.merchantTradeNo,
        goodsName: input.goods,
      },
    });
    return {
      prepayId: data.data?.prepayId ?? '',
      checkoutUrl: data.data?.checkoutUrl ?? data.data?.universalUrl,
      deeplink: data.data?.deeplink,
      qrContent: data.data?.qrContent,
    };
  }

  /**
   * Payout B2C: envía cripto a la cuenta Binance del usuario por su Binance ID o
   * correo (estilo Meru: "retira por el id/correo del usuario validado").
   */
  async payout(input: {
    requestId: string;
    amount: string;
    currency: string;
    receiveType: 'BINANCE_ID' | 'EMAIL';
    receiver: string;
  }): Promise<{ status: string }> {
    const data = await this.signedRequest<{ status: string }>(
      '/binancepay/openapi/payout/transfer',
      {
        requestId: input.requestId,
        batchName: `payout-${input.requestId}`,
        currency: input.currency,
        totalAmount: input.amount,
        totalNumber: 1,
        bizScene: 'DIRECT_TRANSFER',
        transferDetailList: [
          {
            merchantSendId: input.requestId,
            receiveType: input.receiveType,
            receiver: input.receiver,
            transferAmount: input.amount,
            currency: input.currency,
          },
        ],
      },
    );
    return { status: data.status };
  }

  /** Verifica la firma del webhook de Binance Pay (HMAC-SHA512 mayúsculas). */
  verifyWebhook(headers: Record<string, unknown>, rawBody: Buffer): boolean {
    if (!this.enabled) return false;
    const timestamp = String(headers['binancepay-timestamp'] ?? '');
    const nonce = String(headers['binancepay-nonce'] ?? '');
    const sig = String(headers['binancepay-signature'] ?? '');
    const toSign = `${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`;
    const expected = createHmac('sha512', this.cfg.apiSecret)
      .update(toSign)
      .digest('hex')
      .toUpperCase();
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

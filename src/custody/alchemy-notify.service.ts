import { Injectable, Logger } from '@nestjs/common';

/**
 * Registra dinámicamente las direcciones de depósito en el webhook "Address
 * Activity" de Alchemy (Notify API). Como cada usuario tiene su propia dirección,
 * cada vez que se crea una se añade al webhook para recibir el push del depósito.
 *
 * Requiere `ALCHEMY_AUTH_TOKEN` (token de la cuenta, NO la API key) y
 * `ALCHEMY_WEBHOOK_ID`. Si faltan, es no-op: el indexer por polling cubre igual.
 */
@Injectable()
export class AlchemyNotifyService {
  private readonly logger = new Logger(AlchemyNotifyService.name);

  get enabled(): boolean {
    return !!process.env.ALCHEMY_AUTH_TOKEN && !!process.env.ALCHEMY_WEBHOOK_ID;
  }

  /** Añade una dirección al webhook (best-effort; no bloquea la creación). */
  async watchAddress(address: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const res = await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
        method: 'PATCH',
        headers: {
          'X-Alchemy-Token': process.env.ALCHEMY_AUTH_TOKEN as string,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          webhook_id: process.env.ALCHEMY_WEBHOOK_ID,
          addresses_to_add: [address],
          addresses_to_remove: [],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Alchemy Notify add ${address}: HTTP ${res.status}`);
      } else {
        this.logger.log(`Dirección ${address} añadida al webhook de Alchemy`);
      }
    } catch (err) {
      this.logger.warn(`Alchemy Notify add ${address}: ${(err as Error).message}`);
    }
  }
}

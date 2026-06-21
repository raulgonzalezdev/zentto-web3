import { Body, Controller, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { DepositIndexerService } from './deposit-indexer.service';

/** Mapea el nombre de red de Alchemy a la clave de nuestro catálogo. */
const NETWORK_MAP: Record<string, string> = {
  ETH_SEPOLIA: 'sepolia',
  ETH_MAINNET: 'ethereum',
  MATIC_AMOY: 'polygon-amoy',
  POLYGON_AMOY: 'polygon-amoy',
  MATIC_MAINNET: 'polygon',
  BNB_TESTNET: 'bsc-testnet',
  BNB_MAINNET: 'bsc',
};

interface AddressActivity {
  toAddress?: string;
  value?: number;
  asset?: string;
  category?: string;
  hash?: string;
  rawContract?: { rawValue?: string; address?: string; decimals?: number };
  log?: { index?: number; logIndex?: number | string };
}

/** logIndex puede venir como número o como hex string ("0x6e"). */
function toLogIndex(log?: { index?: number; logIndex?: number | string }): number {
  const v = log?.logIndex ?? log?.index ?? 0;
  if (typeof v === 'string') return v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10) || 0;
  return v;
}

/**
 * Recibe notificaciones de Alchemy (webhook "Address Activity") y acredita los
 * depósitos USDC/USDT entrantes a las direcciones de nuestros usuarios — push en
 * tiempo real, complementario al indexer por polling. Valida la firma HMAC.
 */
@ApiTags('webhooks')
@Controller('webhook')
export class AlchemyWebhookController {
  private readonly logger = new Logger(AlchemyWebhookController.name);
  private readonly signingKey: string;

  constructor(
    private readonly indexer: DepositIndexerService,
    config: ConfigService,
  ) {
    this.signingKey = config.get<string>('ALCHEMY_WEBHOOK_SIGNING_KEY') ?? '';
  }

  @Public()
  @Post('alchemy')
  @ApiOperation({ summary: 'Webhook de Alchemy: acredita depósitos entrantes (firma HMAC)' })
  async alchemy(@Req() req: RawBodyRequest<Request>, @Body() body: Record<string, unknown>) {
    this.verifySignature(req);

    const event = (body?.event ?? {}) as { network?: string; activity?: AddressActivity[] };
    const network = NETWORK_MAP[event.network ?? ''] ?? 'sepolia';
    const activity = Array.isArray(event.activity) ? event.activity : [];

    let credited = 0;
    for (const a of activity) {
      // Solo tokens (USDC/USDT); ignorar transferencias nativas.
      if (a.category && a.category !== 'token' && a.category !== 'erc20') continue;
      if (!a.toAddress || !a.hash) continue;
      const rawValue = a.rawContract?.rawValue;
      if (!rawValue) continue;
      const ok = await this.indexer
        .creditWebhookTransfer({
          network,
          tokenAddress: a.rawContract?.address ?? '',
          toAddress: a.toAddress,
          valueRaw: rawValue.startsWith('0x') ? BigInt(rawValue).toString() : rawValue,
          txHash: a.hash,
          logIndex: toLogIndex(a.log),
          decimals: a.rawContract?.decimals ?? 6,
        })
        .catch((err) => {
          this.logger.warn(`Webhook Alchemy: ${(err as Error).message}`);
          return false;
        });
      if (ok) credited++;
    }
    if (credited > 0) this.logger.log(`Webhook Alchemy: ${credited} depósito(s) acreditados`);
    return { ok: true, credited };
  }

  /** Verifica la firma HMAC-SHA256 del body crudo (header x-alchemy-signature). */
  private verifySignature(req: RawBodyRequest<Request>): void {
    if (!this.signingKey) return; // sin key configurada → no se valida (dev)
    const sig = (req.headers['x-alchemy-signature'] as string) ?? '';
    const raw = req.rawBody ?? Buffer.from('');
    const expected = createHmac('sha256', this.signingKey).update(raw).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }
  }
}

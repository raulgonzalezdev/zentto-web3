import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TronWeb } from 'tronweb';
import { CustodyConfig, NetworkConfig, NetworksConfig } from '../config/configuration';

// El hot wallet de tesorería Tron usa la cuenta HD 0; las direcciones de depósito
// usan la cuenta HD 1 → nunca colisionan (mismo patrón que EVM).
const HOT_PATH = "m/44'/195'/0'/0/0";
const depositPath = (index: number) => `m/44'/195'/0'/0/${index + 1}`;

const USDT_DECIMALS = 6;

/**
 * Custodia Tron (TRC-20 USDT). Deriva direcciones de depósito por usuario desde el
 * mnemónico maestro (BIP44 coin 195) y firma retiros desde el hot wallet de tesorería.
 * Lectura de depósitos vía TronGrid. Igual que EVM: ⚠️ la clave solo vive en dev/testnet.
 */
@Injectable()
export class TronService {
  private readonly logger = new Logger(TronService.name);
  private readonly mnemonic: string;
  private readonly net?: NetworkConfig;

  constructor(config: ConfigService) {
    this.mnemonic = config.getOrThrow<CustodyConfig>('custody').mnemonic;
    this.net = config
      .getOrThrow<NetworksConfig>('networks')
      .list.find((n) => n.family === 'tron' && n.enabled);
  }

  get enabled(): boolean {
    return !!this.mnemonic && !!this.net;
  }

  private cfg(): NetworkConfig {
    if (!this.net) throw new ServiceUnavailableException('Red Tron no habilitada');
    return this.net;
  }

  /** Cliente TronWeb (sin clave; para lectura) o con la clave del hot wallet. */
  private client(privateKey?: string): TronWeb {
    const cfg = this.cfg();
    return new TronWeb({
      fullHost: cfg.rpcUrl,
      privateKey: privateKey ? privateKey.replace(/^0x/, '') : undefined,
    });
  }

  private hotAccount(): { address: string; privateKey: string } {
    const a = TronWeb.fromMnemonic(this.mnemonic, HOT_PATH) as {
      address: string;
      privateKey: string;
    };
    return { address: a.address, privateKey: a.privateKey };
  }

  hotWalletAddress(): string {
    return this.hotAccount().address;
  }

  /** Dirección de depósito Tron (base58 T...) derivada por índice HD. */
  deriveAddress(index: number): string {
    const a = TronWeb.fromMnemonic(this.mnemonic, depositPath(index)) as { address: string };
    return a.address;
  }

  /** Transferencias TRC-20 (USDT) entrantes a una dirección, desde un timestamp (ms). */
  async getIncomingTransfers(
    address: string,
    sinceMs: number,
  ): Promise<Array<{ txId: string; from: string; value: bigint; timestamp: number }>> {
    const cfg = this.cfg();
    const url =
      `${cfg.rpcUrl}/v1/accounts/${address}/transactions/trc20` +
      `?only_to=true&contract_address=${cfg.usdcAddress}&min_timestamp=${sinceMs}&limit=50`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`TronGrid ${res.status}`);
    const data = (await res.json()) as {
      data?: Array<{
        transaction_id: string;
        from: string;
        value: string;
        block_timestamp: number;
      }>;
    };
    return (data.data ?? []).map((t) => ({
      txId: t.transaction_id,
      from: t.from,
      value: BigInt(t.value),
      timestamp: t.block_timestamp,
    }));
  }

  /** Estado de una tx Tron: confirmada (success) y nº de confirmaciones aproximadas. */
  async getTransaction(txId: string): Promise<{ status: 'pending' | 'success' | 'reverted' }> {
    const tron = this.client();
    const info = (await tron.trx.getTransactionInfo(txId).catch(() => null)) as {
      blockNumber?: number;
      receipt?: { result?: string };
    } | null;
    if (!info || !info.blockNumber) return { status: 'pending' };
    const ok = !info.receipt?.result || info.receipt.result === 'SUCCESS';
    return { status: ok ? 'success' : 'reverted' };
  }

  /** Firma y emite una transferencia USDT (TRC-20) desde el hot wallet. Devuelve el txId. */
  async sendUsdt(toAddress: string, amount: string): Promise<string> {
    if (!this.enabled) throw new ServiceUnavailableException('Custodia Tron no configurada');
    const cfg = this.cfg();
    const hot = this.hotAccount();
    const tron = this.client(hot.privateKey);
    const contract = await tron.contract().at(cfg.usdcAddress);
    const value = BigInt(Math.round(Number(amount) * 10 ** USDT_DECIMALS)).toString();
    const txId: string = await contract.transfer(toAddress, value).send();
    this.logger.log(`Retiro Tron emitido: ${txId}`);
    return txId;
  }
}

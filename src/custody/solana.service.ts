import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { mnemonicToSeedSync } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { CustodyConfig, NetworkConfig, NetworksConfig } from '../config/configuration';

// El hot wallet de tesorería usa la cuenta HD 0; las direcciones de depósito usan
// índices >=1 → nunca colisionan (mismo patrón que EVM/Tron). Derivación Phantom.
const HOT_PATH = "m/44'/501'/0'/0'";
const depositPath = (index: number) => `m/44'/501'/${index + 1}'/0'`;

export interface SolTransfer {
  txId: string;
  value: bigint;
  asset: string;
  decimals: number;
}

/**
 * Custodia Solana (SPL USDC + USDT). Deriva una dirección única por usuario desde el
 * mnemónico maestro (ed25519, coin 501) — al igual que EVM/Tron, no hay memo. Los
 * tokens SPL llegan a la ATA (Associated Token Account) del usuario; el remitente
 * (Binance/wallet) la crea al enviar. Lectura de depósitos vía RPC Solana.
 * ⚠️ La clave solo vive en dev/testnet; en prod: KMS/MPC.
 */
@Injectable()
export class SolanaService {
  private readonly logger = new Logger(SolanaService.name);
  private readonly mnemonic: string;
  private readonly net?: NetworkConfig;

  constructor(config: ConfigService) {
    this.mnemonic = config.getOrThrow<CustodyConfig>('custody').mnemonic;
    this.net = config
      .getOrThrow<NetworksConfig>('networks')
      .list.find((n) => n.family === 'solana' && n.enabled);
  }

  get enabled(): boolean {
    return !!this.mnemonic && !!this.net;
  }

  private cfg(): NetworkConfig {
    if (!this.net) throw new ServiceUnavailableException('Red Solana no habilitada');
    return this.net;
  }

  private conn(): Connection {
    return new Connection(this.cfg().rpcUrl, 'confirmed');
  }

  private keypair(path: string): Keypair {
    const seed = mnemonicToSeedSync(this.mnemonic);
    const { key } = derivePath(path, seed.toString('hex'));
    return Keypair.fromSeed(key);
  }

  hotWalletAddress(): string {
    return this.keypair(HOT_PATH).publicKey.toBase58();
  }

  /** Dirección de depósito Solana (base58) derivada por índice HD. */
  deriveAddress(index: number): string {
    return this.keypair(depositPath(index)).publicKey.toBase58();
  }

  /**
   * Transferencias SPL (USDC/USDT) entrantes a una dirección. Por cada token mira la
   * ATA del usuario, recorre las firmas recientes y calcula el monto recibido a partir
   * del delta de pre/postTokenBalances (robusto ante creación de ATA en la misma tx).
   */
  async getIncomingTransfers(address: string): Promise<SolTransfer[]> {
    const cfg = this.cfg();
    const conn = this.conn();
    const owner = new PublicKey(address);
    const out: SolTransfer[] = [];

    for (const token of cfg.tokens) {
      const mint = new PublicKey(token.address);
      const ata = await getAssociatedTokenAddress(mint, owner);
      const sigs = await conn
        .getSignaturesForAddress(ata, { limit: 50 }, 'confirmed')
        .catch(() => []);
      for (const s of sigs) {
        if (s.err) continue; // tx fallida
        const tx = await conn
          .getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
          .catch(() => null);
        if (!tx?.meta) continue;
        const mintStr = token.address;
        const post = (tx.meta.postTokenBalances ?? []).find(
          (b) => b.owner === address && b.mint === mintStr,
        );
        if (!post) continue;
        const pre = (tx.meta.preTokenBalances ?? []).find(
          (b) => b.accountIndex === post.accountIndex,
        );
        const delta = BigInt(post.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? '0');
        if (delta <= 0n) continue; // no es un ingreso
        out.push({
          txId: s.signature,
          value: delta,
          asset: token.asset,
          decimals: post.uiTokenAmount.decimals,
        });
      }
    }
    return out;
  }
}

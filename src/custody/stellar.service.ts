import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { CustodyConfig, NetworkConfig, NetworksConfig } from '../config/configuration';

/**
 * Custodia Stellar (USDC). A diferencia de EVM/Tron, NO se deriva una cuenta por
 * usuario (cada cuenta Stellar requiere fondeo + trustline). Se usa UNA cuenta
 * plataforma + un MEMO entero por usuario para enrutar el depósito — el patrón
 * estándar de exchanges en Stellar. ⚠️ Clave solo en dev/testnet.
 */
@Injectable()
export class StellarService {
  private readonly logger = new Logger(StellarService.name);
  private readonly mnemonic: string;
  private readonly net?: NetworkConfig;

  constructor(config: ConfigService) {
    this.mnemonic = config.getOrThrow<CustodyConfig>('custody').mnemonic;
    this.net = config
      .getOrThrow<NetworksConfig>('networks')
      .list.find((n) => n.family === 'stellar' && n.enabled);
  }

  get enabled(): boolean {
    return !!this.mnemonic && !!this.net;
  }

  private cfg(): NetworkConfig {
    if (!this.net) throw new ServiceUnavailableException('Red Stellar no habilitada');
    return this.net;
  }

  private server(): Horizon.Server {
    return new Horizon.Server(this.cfg().rpcUrl);
  }

  /** Cuenta plataforma determinista derivada del mnemónico (seed ed25519 de 32 bytes). */
  private platform(): Keypair {
    const seed = createHash('sha256').update(`${this.mnemonic}:zentto-stellar`).digest();
    return Keypair.fromRawEd25519Seed(seed);
  }

  platformAddress(): string {
    return this.platform().publicKey();
  }

  private asset(): Asset {
    return new Asset('USDC', this.cfg().usdcAddress);
  }

  /** Info de depósito: dirección de la plataforma + memo entero del usuario. */
  depositInfo(memoId: number): { address: string; memo: string } {
    return { address: this.platformAddress(), memo: String(memoId) };
  }

  /** Pagos USDC entrantes a la cuenta plataforma (con su memo para enrutar). */
  async getIncomingPayments(
    limit = 50,
  ): Promise<Array<{ txId: string; from: string; amount: string; memo: string | null }>> {
    const server = this.server();
    const page = await server
      .payments()
      .forAccount(this.platformAddress())
      .order('desc')
      .limit(limit)
      .call();

    const out: Array<{ txId: string; from: string; amount: string; memo: string | null }> = [];
    for (const op of page.records) {
      if (op.type !== 'payment') continue;
      const p = op as Horizon.ServerApi.PaymentOperationRecord;
      if (p.to !== this.platformAddress()) continue; // solo entrantes
      if (p.asset_type === 'native' || p.asset_code !== 'USDC') continue;
      const tx = await p.transaction().catch(() => null);
      out.push({
        txId: p.transaction_hash,
        from: p.from,
        amount: p.amount,
        memo: tx?.memo ?? null,
      });
    }
    return out;
  }

  /** Estado de una tx Stellar (en Stellar una tx incluida es definitiva). */
  async getTransaction(txId: string): Promise<{ status: 'pending' | 'success' | 'reverted' }> {
    const tx = await this.server()
      .transactions()
      .transaction(txId)
      .call()
      .catch(() => null);
    if (!tx) return { status: 'pending' };
    return { status: tx.successful ? 'success' : 'reverted' };
  }

  /** Firma y emite un pago USDC desde la cuenta plataforma. Devuelve el hash. */
  async sendUsdc(toAddress: string, amount: string, memo?: string): Promise<string> {
    if (!this.enabled) throw new ServiceUnavailableException('Custodia Stellar no configurada');
    const server = this.server();
    const kp = this.platform();
    const account = await server.loadAccount(kp.publicKey());
    const fee = (await server.fetchBaseFee()).toString();
    const builder = new TransactionBuilder(account, {
      fee,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({ destination: toAddress, asset: this.asset(), amount: String(amount) }),
      )
      .setTimeout(60);
    if (memo) builder.addMemo(Memo.text(memo.slice(0, 28)));
    const tx = builder.build();
    tx.sign(kp);
    const res = await server.submitTransaction(tx);
    this.logger.log(`Retiro Stellar emitido: ${res.hash}`);
    return res.hash;
  }
}

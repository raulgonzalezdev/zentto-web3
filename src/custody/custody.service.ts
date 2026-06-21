import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  Chain,
  createWalletClient,
  defineChain,
  fallback,
  http,
  parseUnits,
  WalletClient,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { CustodyConfig, NetworkConfig, NetworksConfig } from '../config/configuration';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { AlchemyNotifyService } from './alchemy-notify.service';
import { SolanaService } from './solana.service';
import { StellarService } from './stellar.service';
import { TronService } from './tron.service';

// Dirección de depósito compartida por TODA la familia EVM (misma clave HD → misma
// address en Sepolia/Polygon/BSC). Por eso se almacena bajo una clave canónica.
const NETWORK_EVM = 'evm';

// El hot wallet (tesorería que paga los retiros) usa la cuenta HD 0; las
// direcciones de depósito usan la cuenta HD 1 → nunca colisionan.
const HOT_ACCOUNT_INDEX = 0;
const DEPOSIT_ACCOUNT_INDEX = 1;

/** ABI mínimo de `transfer(address,uint256)` de un ERC-20. */
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Custodia (DEV/testnet): deriva direcciones de depósito por usuario y firma los
 * retiros desde el hot wallet de tesorería, ambos desde el mnemónico maestro (HD).
 *
 * ⚠️ El mnemónico vive en .env SOLO en dev/testnet. En PRODUCCIÓN la clave nunca
 * toca el proceso: firma vía KMS/HSM o MPC (Fireblocks/Turnkey). Este servicio es
 * la única frontera que maneja llaves; el resto del sistema es solo-lectura.
 */
@Injectable()
export class CustodyService implements OnModuleInit {
  private readonly logger = new Logger(CustodyService.name);
  private readonly custody: CustodyConfig;
  /** Redes EVM operativas, por clave (chain viem + metadatos). */
  private readonly evmNets = new Map<string, { cfg: NetworkConfig; chain: Chain }>();
  /** Todas las redes habilitadas por clave (para resolver familia: evm/tron/stellar). */
  private readonly netByKey = new Map<string, NetworkConfig>();
  private readonly primaryKey: string;

  constructor(
    @InjectRepository(DepositAddressEntity)
    private readonly deposits: Repository<DepositAddressEntity>,
    private readonly tron: TronService,
    private readonly stellar: StellarService,
    private readonly solana: SolanaService,
    private readonly notify: AlchemyNotifyService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.custody = config.getOrThrow<CustodyConfig>('custody');
    const list = config.getOrThrow<NetworksConfig>('networks').list;
    for (const n of list) if (n.enabled) this.netByKey.set(n.key, n);
    const evmNets = list.filter((n) => n.family === 'evm' && n.enabled);
    for (const cfg of evmNets) {
      const chain = defineChain({
        id: cfg.chainId,
        name: cfg.name,
        nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl] } },
        blockExplorers: { default: { name: 'Explorer', url: cfg.explorerUrl } },
      });
      this.evmNets.set(cfg.key, { cfg, chain });
    }
    this.primaryKey = evmNets[0]?.key ?? 'sepolia';
  }

  onModuleInit(): void {
    if (this.enabled) {
      const nets = [...this.evmNets.values()].map((n) => n.cfg.name).join(', ');
      this.logger.log(
        `Hot wallet de tesorería: ${this.hotWalletAddress()} — fondéalo con gas + USDC en: ${nets}`,
      );
    }
  }

  private evmNet(key?: string): { cfg: NetworkConfig; chain: Chain } {
    const e = this.evmNets.get(key ?? this.primaryKey);
    if (!e) throw new ServiceUnavailableException(`Red EVM no soportada: ${key}`);
    return e;
  }

  get enabled(): boolean {
    return !!this.custody.mnemonic;
  }

  private deriveEvm(index: number): string {
    const account = mnemonicToAccount(this.custody.mnemonic, {
      accountIndex: DEPOSIT_ACCOUNT_INDEX,
      addressIndex: index,
    });
    return account.address;
  }

  private hotAccount() {
    return mnemonicToAccount(this.custody.mnemonic, {
      accountIndex: HOT_ACCOUNT_INDEX,
      addressIndex: 0,
    });
  }

  hotWalletAddress(): string {
    return this.hotAccount().address;
  }

  /**
   * Firma y emite una transferencia USDC desde el hot wallet hacia una address
   * externa, EN LA RED indicada. Devuelve el txHash. Lanza si falta gas/saldo (lo
   * maneja el worker de retiros liberando el hold = reembolso).
   */
  async sendUsdc(toAddress: string, amount: string, networkKey?: string): Promise<string> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Custodia no configurada (CUSTODY_MNEMONIC ausente)');
    }
    const { cfg, chain } = this.evmNet(networkKey);
    const transport = cfg.fallbackRpcUrl
      ? fallback([http(cfg.rpcUrl), http(cfg.fallbackRpcUrl)])
      : http(cfg.rpcUrl);
    const wallet: WalletClient = createWalletClient({
      account: this.hotAccount(),
      chain,
      transport,
    });
    const value = parseUnits(amount, 6); // USDC = 6 decimales
    return wallet.writeContract({
      account: this.hotAccount(),
      chain,
      address: cfg.usdcAddress as `0x${string}`,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [toAddress as `0x${string}`, value],
    });
  }

  /** Devuelve (o asigna) la dirección de depósito EVM del usuario. */
  async getOrCreateEvmDepositAddress(userId: string): Promise<DepositAddressEntity> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Custodia no configurada (CUSTODY_MNEMONIC ausente)');
    }
    const existing = await this.deposits.findOne({ where: { userId, network: NETWORK_EVM } });
    if (existing) return existing;

    // Asigna el siguiente índice libre; reintenta si choca por carrera (unique).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(DepositAddressEntity);
          const count = await repo.count({ where: { network: NETWORK_EVM } });
          const index = count;
          const entity = repo.create({
            id: randomUUID(),
            userId,
            network: NETWORK_EVM,
            address: this.deriveEvm(index),
            derivationIndex: index,
          });
          const saved = await repo.save(entity);
          // Registra la dirección en el webhook de Alchemy (best-effort, no bloquea).
          void this.notify.watchAddress(saved.address);
          return saved;
        });
      } catch (e) {
        const code =
          (e as { code?: string; driverError?: { code?: string } })?.code ??
          (e as { driverError?: { code?: string } })?.driverError?.code;
        if (code === '23505') {
          const again = await this.deposits.findOne({ where: { userId, network: NETWORK_EVM } });
          if (again) return again;
          continue; // índice tomado por otro: reintenta
        }
        throw e;
      }
    }
    throw new ServiceUnavailableException('No se pudo asignar dirección de depósito');
  }

  /** Asigna (o devuelve) un registro de depósito para una familia no-EVM. */
  private async getOrCreateAddress(
    userId: string,
    network: string,
    derive: (index: number) => string,
  ): Promise<DepositAddressEntity> {
    const existing = await this.deposits.findOne({ where: { userId, network } });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const repo = manager.getRepository(DepositAddressEntity);
          const index = await repo.count({ where: { network } });
          return repo.save(
            repo.create({
              id: randomUUID(),
              userId,
              network,
              address: derive(index),
              derivationIndex: index,
            }),
          );
        });
      } catch (e) {
        const code =
          (e as { code?: string; driverError?: { code?: string } })?.code ??
          (e as { driverError?: { code?: string } })?.driverError?.code;
        if (code === '23505') {
          const again = await this.deposits.findOne({ where: { userId, network } });
          if (again) return again;
          continue;
        }
        throw e;
      }
    }
    throw new ServiceUnavailableException('No se pudo asignar dirección de depósito');
  }

  /** Info de depósito por red — rutea por familia (EVM compartida / Tron / Stellar+memo). */
  async depositInfo(userId: string, networkKey?: string) {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Custodia no configurada (CUSTODY_MNEMONIC ausente)');
    }
    const cfg = networkKey ? this.netByKey.get(networkKey) : this.evmNet().cfg;
    if (!cfg) throw new ServiceUnavailableException(`Red no soportada: ${networkKey}`);
    // Seguridad anti-pérdida: NO entregar dirección de una red que aún no indexamos
    // (sin indexer, un depósito ahí no se acreditaría).
    if (!cfg.available) {
      throw new ServiceUnavailableException(
        `La red ${cfg.name} aún no está disponible para depósitos. Usa Ethereum, Polygon o BSC.`,
      );
    }

    if (cfg.family === 'tron') {
      const dep = await this.getOrCreateAddress(userId, 'tron', (i) => this.tron.deriveAddress(i));
      return {
        network: cfg.key,
        chainName: cfg.name,
        nativeSymbol: cfg.nativeSymbol,
        address: dep.address,
        asset: 'USDT',
        token: cfg.usdcAddress,
        explorerUrl: `${cfg.explorerUrl}/address/${dep.address}`,
        note: `Envía USDT (TRC-20) en ${cfg.name} a esta dirección. El indexer lo detecta y acredita tu saldo.`,
      };
    }

    if (cfg.family === 'solana') {
      // Dirección única por usuario (SPL). El remitente crea la ATA al enviar.
      const dep = await this.getOrCreateAddress(userId, 'solana', (i) =>
        this.solana.deriveAddress(i),
      );
      return {
        network: cfg.key,
        chainName: cfg.name,
        nativeSymbol: cfg.nativeSymbol,
        address: dep.address,
        asset: 'USDC',
        token: cfg.usdcAddress,
        explorerUrl: `${cfg.explorerUrl}/account/${dep.address}`,
        note: `Envía USDC o USDT (SPL) en ${cfg.name} a esta dirección. El indexer lo detecta y acredita tu saldo.`,
      };
    }

    if (cfg.family === 'stellar') {
      // Cuenta plataforma compartida + memo por usuario (índice HD como memo).
      const dep = await this.getOrCreateAddress(userId, 'stellar', () =>
        this.stellar.platformAddress(),
      );
      const { address, memo } = this.stellar.depositInfo(dep.derivationIndex);
      return {
        network: cfg.key,
        chainName: cfg.name,
        nativeSymbol: cfg.nativeSymbol,
        address,
        memo, // OBLIGATORIO: sin el memo el depósito no se puede enrutar
        asset: 'USDC',
        token: cfg.usdcAddress,
        explorerUrl: `${cfg.explorerUrl}/account/${address}`,
        note: `Envía USDC en ${cfg.name} a esta dirección INCLUYENDO el memo ${memo}. Sin el memo no podremos acreditar tu depósito.`,
      };
    }

    // EVM (familia): dirección compartida entre todas las redes EVM.
    const { cfg: evmCfg } = this.evmNet(networkKey);
    const dep = await this.getOrCreateEvmDepositAddress(userId);
    return {
      network: evmCfg.key,
      chainName: evmCfg.name,
      chainId: evmCfg.chainId,
      nativeSymbol: evmCfg.nativeSymbol,
      address: dep.address,
      asset: 'USDC',
      token: evmCfg.usdcAddress,
      explorerUrl: `${evmCfg.explorerUrl}/address/${dep.address}`,
      note: `Envía USDC en ${evmCfg.name} a esta dirección. La misma dirección sirve para todas las redes EVM.`,
    };
  }
}

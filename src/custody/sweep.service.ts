import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  formatUnits,
  http,
  parseUnits,
  PublicClient,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { CustodyConfig, NetworkConfig, NetworksConfig } from '../config/configuration';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';

const NETWORK_EVM = 'evm';
const HOT_ACCOUNT_INDEX = 0;
const DEPOSIT_ACCOUNT_INDEX = 1;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
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

interface EvmNet {
  cfg: NetworkConfig;
  chain: Chain;
  client: PublicClient;
}

/**
 * Sweep (barrido): consolida los fondos que caen en las direcciones de depósito
 * (una por usuario) hacia el HOT WALLET, que es quien firma los retiros. Sin esto,
 * el hot wallet está vacío y los retiros on-chain fallarían.
 *
 * Por cada dirección con saldo de token:
 *   1. Si no tiene gas nativo suficiente, el hot wallet le envía un poco (auto-gas).
 *   2. La dirección de depósito firma un transfer del 100% del token → hot wallet.
 *
 * El hot wallet debe tener gas nativo (BNB/ETH/POL). Se activa con SWEEP_ENABLED=true.
 */
@Injectable()
export class SweepService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SweepService.name);
  private readonly mnemonic: string;
  private readonly nets = new Map<string, EvmNet>();
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(DepositAddressEntity)
    private readonly deposits: Repository<DepositAddressEntity>,
    config: ConfigService,
  ) {
    this.mnemonic = config.getOrThrow<CustodyConfig>('custody').mnemonic;
    this.enabled = (process.env.SWEEP_ENABLED ?? 'false') === 'true';
    this.intervalMs = parseInt(process.env.SWEEP_INTERVAL_SEC ?? '300', 10) * 1000;
    const list = config.getOrThrow<NetworksConfig>('networks').list;
    for (const cfg of list.filter((n) => n.family === 'evm' && n.enabled)) {
      const chain = defineChain({
        id: cfg.chainId,
        name: cfg.name,
        nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl] } },
      });
      const transport = cfg.fallbackRpcUrl
        ? fallback([http(cfg.rpcUrl), http(cfg.fallbackRpcUrl)])
        : http(cfg.rpcUrl);
      const client = createPublicClient({ chain, transport }) as PublicClient;
      this.nets.set(cfg.key, { cfg, chain, client });
    }
  }

  onModuleInit(): void {
    if (this.enabled && this.mnemonic) {
      this.timer = setInterval(() => void this.sweepAll().catch(() => undefined), this.intervalMs);
      this.logger.log(`Sweep activo (cada ${this.intervalMs / 1000}s)`);
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private hotAccount() {
    return mnemonicToAccount(this.mnemonic, {
      accountIndex: HOT_ACCOUNT_INDEX,
      addressIndex: 0,
    });
  }

  private depositAccount(index: number) {
    return mnemonicToAccount(this.mnemonic, {
      accountIndex: DEPOSIT_ACCOUNT_INDEX,
      addressIndex: index,
    });
  }

  private walletFor(net: EvmNet, account: ReturnType<typeof mnemonicToAccount>) {
    const transport = net.cfg.fallbackRpcUrl
      ? fallback([http(net.cfg.rpcUrl), http(net.cfg.fallbackRpcUrl)])
      : http(net.cfg.rpcUrl);
    return createWalletClient({ account, chain: net.chain, transport });
  }

  /** Barre TODAS las redes EVM. Devuelve cuántas transferencias de barrido se hicieron. */
  async sweepAll(): Promise<{ swept: number; gasTopUps: number }> {
    if (this.running) return { swept: 0, gasTopUps: 0 };
    this.running = true;
    let swept = 0;
    let gasTopUps = 0;
    try {
      const rows = await this.deposits.find({ where: { network: NETWORK_EVM } });
      if (rows.length === 0) return { swept, gasTopUps };
      const hot = this.hotAccount();
      for (const net of this.nets.values()) {
        for (const row of rows) {
          for (const token of net.cfg.tokens ?? []) {
            try {
              const r = await this.sweepOne(net, hot.address, row.derivationIndex, token);
              if (r === 'swept') swept++;
              else if (r === 'gas') gasTopUps++;
            } catch (e) {
              this.logger.warn(
                `Sweep ${net.cfg.key} ${row.address} ${token.asset}: ${(e as Error).message}`,
              );
            }
          }
        }
      }
      if (swept > 0) this.logger.log(`Sweep: ${swept} barrido(s), ${gasTopUps} recarga(s) de gas`);
      return { swept, gasTopUps };
    } finally {
      this.running = false;
    }
  }

  private async sweepOne(
    net: EvmNet,
    hotAddress: string,
    index: number,
    token: { address: string; asset: string; decimals: number },
  ): Promise<'swept' | 'gas' | 'skip'> {
    const dep = this.depositAccount(index);
    const depAddr = dep.address;

    const balance = (await net.client.readContract({
      address: token.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [depAddr],
    })) as bigint;

    // Umbral mínimo (evita barrer polvo y malgastar gas): 0.5 del token.
    const minRaw = parseUnits('0.5', token.decimals);
    if (balance < minRaw) return 'skip';

    // ¿Tiene gas para 1 transfer ERC-20? Si no, el hot wallet le envía.
    const gasPrice = await net.client.getGasPrice();
    const gasNeeded = gasPrice * 120_000n; // límite holgado para un transfer
    const native = await net.client.getBalance({ address: depAddr });
    if (native < gasNeeded) {
      const hotWallet = this.walletFor(net, this.hotAccount());
      const topUp = gasNeeded * 2n - native; // deja margen para reintentos
      const gasTx = await hotWallet.sendTransaction({
        account: this.hotAccount(),
        chain: net.chain,
        to: depAddr,
        value: topUp,
      });
      await net.client.waitForTransactionReceipt({ hash: gasTx, timeout: 120_000 });
      this.logger.log(
        `Gas → ${depAddr} en ${net.cfg.key}: ${formatUnits(topUp, 18)} ${net.cfg.nativeSymbol}`,
      );
      return 'gas'; // en el próximo ciclo ya con gas se barre el token
    }

    // Barre el 100% del token al hot wallet, firmando desde la dirección de depósito.
    const depWallet = this.walletFor(net, dep);
    const tx = await depWallet.writeContract({
      account: dep,
      chain: net.chain,
      address: token.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [hotAddress as `0x${string}`, balance],
    });
    this.logger.log(
      `Sweep ${formatUnits(balance, token.decimals)} ${token.asset} ${depAddr} → hot (${net.cfg.key}) tx ${tx}`,
    );
    return 'swept';
  }
}

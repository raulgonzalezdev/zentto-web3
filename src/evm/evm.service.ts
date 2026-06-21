import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Chain,
  createPublicClient,
  defineChain,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseAbiItem,
  PublicClient,
} from 'viem';
import { NetworkConfig, NetworksConfig } from '../config/configuration';

/** ABI mínimo ERC-20 para leer saldo, decimales y símbolo de un token. */
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

export interface TokenBalance {
  symbol: string;
  address: string;
  decimals: number;
  raw: string;
  formatted: string;
}

/**
 * Capa de conexión a una red EVM REAL (Sepolia por defecto) vía `viem`.
 *
 * Solo LECTURA: nunca custodia llaves ni firma. La firma de transacciones la hace
 * la wallet del usuario (no custodial) o, en el modelo custodial del neobanco, un
 * servicio de custodia/MPC aparte. Aquí solo consultamos la cadena pública.
 */
interface NetEntry {
  cfg: NetworkConfig;
  chain: Chain;
  client: PublicClient;
}

@Injectable()
export class EvmService implements OnModuleInit {
  private readonly logger = new Logger(EvmService.name);
  private readonly nets = new Map<string, NetEntry>();
  private readonly primaryKey: string;

  constructor(config: ConfigService) {
    const networks = config.getOrThrow<NetworksConfig>('networks').list;
    const evmNets = networks.filter((n) => n.family === 'evm' && n.enabled);
    for (const cfg of evmNets) {
      const chain = defineChain({
        id: cfg.chainId,
        name: cfg.name,
        nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl] } },
        blockExplorers: { default: { name: 'Explorer', url: cfg.explorerUrl } },
      });
      const client = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
      this.nets.set(cfg.key, { cfg, chain, client });
    }
    this.primaryKey = evmNets[0]?.key ?? 'sepolia';
  }

  async onModuleInit(): Promise<void> {
    for (const { cfg, client } of this.nets.values()) {
      try {
        const block = await client.getBlockNumber();
        this.logger.log(`Conectado a ${cfg.name} (chainId=${cfg.chainId}) — bloque ${block}`);
      } catch (err) {
        this.logger.warn(`No se pudo conectar al RPC de ${cfg.name}: ${(err as Error).message}`);
      }
    }
  }

  /** Claves de las redes EVM operativas (para que el indexer las recorra). */
  get evmKeys(): string[] {
    return [...this.nets.keys()];
  }

  private entry(key?: string): NetEntry {
    const k = key ?? this.primaryKey;
    const e = this.nets.get(k);
    if (!e) throw new BadRequestException(`Red EVM no soportada o deshabilitada: ${k}`);
    return e;
  }

  cfgOf(key?: string): NetworkConfig {
    return this.entry(key).cfg;
  }

  async getInfo(key?: string) {
    const { cfg, client } = this.entry(key);
    const blockNumber = await client.getBlockNumber();
    return {
      network: cfg.key,
      chainId: cfg.chainId,
      chainName: cfg.name,
      explorerUrl: cfg.explorerUrl,
      nativeSymbol: cfg.nativeSymbol,
      blockNumber: blockNumber.toString(),
      defaultToken: cfg.usdcAddress,
    };
  }

  private assertAddress(address: string): `0x${string}` {
    if (!isAddress(address)) throw new BadRequestException(`Address EVM inválida: ${address}`);
    return address as `0x${string}`;
  }

  /** Saldo nativo + el token por defecto (USDC) de una address en una red. */
  async getAddress(address: string, key?: string) {
    const { cfg, client } = this.entry(key);
    const addr = this.assertAddress(address);
    const [wei, token] = await Promise.all([
      client.getBalance({ address: addr }),
      this.getTokenBalance(cfg.usdcAddress, addr, key).catch(() => null),
    ]);
    return {
      address: addr,
      network: cfg.key,
      native: { symbol: cfg.nativeSymbol, raw: wei.toString(), formatted: formatEther(wei) },
      tokens: token ? [token] : [],
      explorerUrl: `${cfg.explorerUrl}/address/${addr}`,
    };
  }

  /** Saldo de cualquier token ERC-20 para una address en una red. */
  async getTokenBalance(tokenAddress: string, address: string, key?: string): Promise<TokenBalance> {
    const { client } = this.entry(key);
    const token = this.assertAddress(tokenAddress);
    const addr = this.assertAddress(address);
    const [raw, decimals, symbol] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }),
    ]);
    return {
      symbol: symbol as string,
      address: token,
      decimals: Number(decimals),
      raw: (raw as bigint).toString(),
      formatted: formatUnits(raw as bigint, Number(decimals)),
    };
  }

  // ─────────────────────────── Indexer (depósitos) ───────────────────────────

  async currentBlock(key?: string): Promise<bigint> {
    return this.entry(key).client.getBlockNumber();
  }

  async tokenDecimals(tokenAddress: string, key?: string): Promise<number> {
    const { client } = this.entry(key);
    const token = this.assertAddress(tokenAddress);
    const dec = await client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' });
    return Number(dec);
  }

  /** Eventos Transfer ERC-20 hacia un conjunto de direcciones, en un rango de bloques. */
  async getErc20TransfersTo(
    tokenAddress: string,
    toAddresses: string[],
    fromBlock: bigint,
    toBlock: bigint,
    key?: string,
  ): Promise<
    Array<{ txHash: string; logIndex: number; to: string; value: bigint; blockNumber: bigint }>
  > {
    if (toAddresses.length === 0) return [];
    const { client } = this.entry(key);
    const token = this.assertAddress(tokenAddress);
    const logs = await client.getLogs({
      address: token,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
      args: { to: toAddresses as `0x${string}`[] },
      fromBlock,
      toBlock,
    });
    return logs.map((l) => ({
      txHash: l.transactionHash as string,
      logIndex: l.logIndex as number,
      to: (l.args.to as string).toLowerCase(),
      value: l.args.value as bigint,
      blockNumber: l.blockNumber as bigint,
    }));
  }

  /** Estado de una transacción por hash (confirmaciones, éxito/fallo) en una red. */
  async getTransaction(hash: string, key?: string) {
    const { cfg, client } = this.entry(key);
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new BadRequestException(`Hash de transacción inválido: ${hash}`);
    }
    const txHash = hash as `0x${string}`;
    const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) {
      return {
        hash: txHash,
        status: 'pending',
        confirmations: 0,
        explorerUrl: `${cfg.explorerUrl}/tx/${txHash}`,
      };
    }
    const current = await client.getBlockNumber();
    const confirmations = Number(current - receipt.blockNumber) + 1;
    return {
      hash: txHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      confirmations,
      from: receipt.from,
      to: receipt.to,
      explorerUrl: `${cfg.explorerUrl}/tx/${txHash}`,
    };
  }
}

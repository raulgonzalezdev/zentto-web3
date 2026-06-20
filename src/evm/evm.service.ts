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
  PublicClient,
} from 'viem';
import { EvmConfig } from '../config/configuration';

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
@Injectable()
export class EvmService implements OnModuleInit {
  private readonly logger = new Logger(EvmService.name);
  private readonly cfg: EvmConfig;
  private readonly chain: Chain;
  private readonly client: PublicClient;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<EvmConfig>('evm');
    this.chain = defineChain({
      id: this.cfg.chainId,
      name: this.cfg.chainName,
      nativeCurrency: { name: this.cfg.nativeSymbol, symbol: this.cfg.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [this.cfg.rpcUrl] } },
      blockExplorers: { default: { name: 'Explorer', url: this.cfg.explorerUrl } },
    });
    this.client = createPublicClient({ chain: this.chain, transport: http(this.cfg.rpcUrl) });
  }

  async onModuleInit(): Promise<void> {
    try {
      const block = await this.client.getBlockNumber();
      this.logger.log(
        `Conectado a ${this.cfg.chainName} (chainId=${this.cfg.chainId}) — bloque ${block}`,
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo conectar al RPC EVM (${this.cfg.rpcUrl}): ${(err as Error).message}`,
      );
    }
  }

  async getInfo() {
    const blockNumber = await this.client.getBlockNumber();
    return {
      chainId: this.cfg.chainId,
      chainName: this.cfg.chainName,
      explorerUrl: this.cfg.explorerUrl,
      nativeSymbol: this.cfg.nativeSymbol,
      blockNumber: blockNumber.toString(),
      defaultToken: this.cfg.usdcAddress,
    };
  }

  private assertAddress(address: string): `0x${string}` {
    if (!isAddress(address)) throw new BadRequestException(`Address EVM inválida: ${address}`);
    return address as `0x${string}`;
  }

  /** Saldo nativo (ETH) + el token por defecto (USDC) de una address. */
  async getAddress(address: string) {
    const addr = this.assertAddress(address);
    const [wei, token] = await Promise.all([
      this.client.getBalance({ address: addr }),
      this.getTokenBalance(this.cfg.usdcAddress, addr).catch(() => null),
    ]);
    return {
      address: addr,
      native: {
        symbol: this.cfg.nativeSymbol,
        raw: wei.toString(),
        formatted: formatEther(wei),
      },
      tokens: token ? [token] : [],
      explorerUrl: `${this.cfg.explorerUrl}/address/${addr}`,
    };
  }

  /** Saldo de cualquier token ERC-20 para una address. */
  async getTokenBalance(tokenAddress: string, address: string): Promise<TokenBalance> {
    const token = this.assertAddress(tokenAddress);
    const addr = this.assertAddress(address);
    const [raw, decimals, symbol] = await Promise.all([
      this.client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [addr],
      }),
      this.client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
      this.client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }),
    ]);
    return {
      symbol: symbol as string,
      address: token,
      decimals: Number(decimals),
      raw: (raw as bigint).toString(),
      formatted: formatUnits(raw as bigint, Number(decimals)),
    };
  }

  /** Estado de una transacción por hash (confirmaciones, éxito/fallo). */
  async getTransaction(hash: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new BadRequestException(`Hash de transacción inválido: ${hash}`);
    }
    const txHash = hash as `0x${string}`;
    const receipt = await this.client.getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) {
      return {
        hash: txHash,
        status: 'pending',
        confirmations: 0,
        explorerUrl: `${this.cfg.explorerUrl}/tx/${txHash}`,
      };
    }
    const current = await this.client.getBlockNumber();
    const confirmations = Number(current - receipt.blockNumber) + 1;
    return {
      hash: txHash,
      status: receipt.status, // 'success' | 'reverted'
      blockNumber: receipt.blockNumber.toString(),
      confirmations,
      from: receipt.from,
      to: receipt.to,
      explorerUrl: `${this.cfg.explorerUrl}/tx/${txHash}`,
    };
  }
}

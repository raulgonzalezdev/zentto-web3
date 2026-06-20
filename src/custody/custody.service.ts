import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { Chain, createWalletClient, defineChain, http, parseUnits, WalletClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { CustodyConfig, EvmConfig } from '../config/configuration';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';

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
  private readonly evm: EvmConfig;
  private readonly chain: Chain;

  constructor(
    @InjectRepository(DepositAddressEntity)
    private readonly deposits: Repository<DepositAddressEntity>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.custody = config.getOrThrow<CustodyConfig>('custody');
    this.evm = config.getOrThrow<EvmConfig>('evm');
    this.chain = defineChain({
      id: this.evm.chainId,
      name: this.evm.chainName,
      nativeCurrency: { name: this.evm.nativeSymbol, symbol: this.evm.nativeSymbol, decimals: 18 },
      rpcUrls: { default: { http: [this.evm.rpcUrl] } },
      blockExplorers: { default: { name: 'Explorer', url: this.evm.explorerUrl } },
    });
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.logger.log(
        `Hot wallet de tesorería: ${this.hotWalletAddress()} — fondéalo con ${this.evm.nativeSymbol} (gas) + USDC de testnet para procesar retiros`,
      );
    }
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
   * externa. Devuelve el txHash. Lanza si falta gas/saldo (lo maneja el worker
   * de retiros liberando el hold = reembolso).
   */
  async sendUsdc(toAddress: string, amount: string): Promise<string> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Custodia no configurada (CUSTODY_MNEMONIC ausente)');
    }
    const wallet: WalletClient = createWalletClient({
      account: this.hotAccount(),
      chain: this.chain,
      transport: http(this.evm.rpcUrl),
    });
    const value = parseUnits(amount, 6); // USDC = 6 decimales
    return wallet.writeContract({
      account: this.hotAccount(),
      chain: this.chain,
      address: this.evm.usdcAddress as `0x${string}`,
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
          return repo.save(entity);
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

  async depositInfo(userId: string) {
    const dep = await this.getOrCreateEvmDepositAddress(userId);
    return {
      network: dep.network,
      chainName: this.evm.chainName,
      address: dep.address,
      asset: this.evm.nativeSymbol,
      token: this.evm.usdcAddress,
      explorerUrl: `${this.evm.explorerUrl}/address/${dep.address}`,
      note: 'Envía USDC de testnet a esta dirección. El indexer detecta el depósito y acredita tu saldo.',
    };
  }
}

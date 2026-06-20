import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { mnemonicToAccount } from 'viem/accounts';
import { CustodyConfig, EvmConfig } from '../config/configuration';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';

const NETWORK_EVM = 'evm';

/**
 * Custodia (DEV/testnet): deriva una dirección de depósito por usuario desde el
 * mnemónico maestro (HD, índice incremental). Solo derivación de DIRECCIONES;
 * la firma de retiros (clave privada) será un servicio aparte (MPC/HSM en prod).
 */
@Injectable()
export class CustodyService {
  private readonly custody: CustodyConfig;
  private readonly evm: EvmConfig;

  constructor(
    @InjectRepository(DepositAddressEntity)
    private readonly deposits: Repository<DepositAddressEntity>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.custody = config.getOrThrow<CustodyConfig>('custody');
    this.evm = config.getOrThrow<EvmConfig>('evm');
  }

  get enabled(): boolean {
    return !!this.custody.mnemonic;
  }

  private deriveEvm(index: number): string {
    const account = mnemonicToAccount(this.custody.mnemonic, { addressIndex: index });
    return account.address;
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
      note: 'Envía fondos de testnet a esta dirección. La detección de depósitos y el abono al saldo es la siguiente fase.',
    };
  }
}

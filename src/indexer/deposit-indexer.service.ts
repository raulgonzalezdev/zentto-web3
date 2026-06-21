import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { formatUnits } from 'viem';
import { IndexerConfig } from '../config/configuration';
import { ChainCursorEntity } from '../database/entities/chain-cursor.entity';
import { ChainDepositEntity } from '../database/entities/chain-deposit.entity';
import { DepositAddressEntity } from '../database/entities/deposit-address.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { EvmService } from '../evm/evm.service';
import { FEE_ACCOUNT, FeeService } from '../fees/fee.service';
import { isPositive } from '../common/money.util';
import { LedgerService } from '../ledger/ledger.service';

// Las direcciones de depósito EVM se almacenan bajo esta clave canónica (compartida).
const NETWORK_EVM = 'evm';
const SYSTEM_CUSTODY = 'custody';

export interface ScanResult {
  fromBlock: string;
  toBlock: string;
  found: number;
  credited: number;
}

/**
 * Indexer de depósitos: detecta transferencias ERC-20 (USDC) entrantes a las
 * direcciones de depósito de los usuarios y las acredita al ledger (doble
 * entrada: debita la cuenta de custodia del sistema, acredita al usuario).
 * Idempotente por (network, txHash, logIndex) → un depósito nunca se acredita
 * dos veces aunque se re-escanee.
 */
@Injectable()
export class DepositIndexerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DepositIndexerService.name);
  private readonly cfg: IndexerConfig;
  private scanning = false;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(DepositAddressEntity)
    private readonly deposits: Repository<DepositAddressEntity>,
    @InjectRepository(ChainCursorEntity) private readonly cursors: Repository<ChainCursorEntity>,
    @InjectRepository(ChainDepositEntity)
    private readonly chainDeposits: Repository<ChainDepositEntity>,
    private readonly evm: EvmService,
    private readonly ledger: LedgerService,
    private readonly fees: FeeService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<IndexerConfig>('indexer');
  }

  onModuleInit(): void {
    if (this.cfg.enabled) {
      this.timer = setInterval(() => void this.scan().catch(() => undefined), 30_000);
      this.logger.log('Indexer de depósitos activo (escaneo cada 30s)');
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async listUserDeposits(userId: string): Promise<ChainDepositEntity[]> {
    return this.chainDeposits.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  /** Un ciclo de escaneo: recorre TODAS las redes EVM habilitadas. */
  async scan(): Promise<ScanResult> {
    if (this.scanning) return { fromBlock: '0', toBlock: '0', found: 0, credited: 0 };
    this.scanning = true;
    try {
      // Direcciones de depósito EVM (compartidas entre redes de la familia).
      const addrRows = await this.deposits.find({ where: { network: NETWORK_EVM } });
      const byAddress = new Map(addrRows.map((a) => [a.address.toLowerCase(), a.userId]));
      const addresses = addrRows.map((a) => a.address);
      if (addresses.length === 0) {
        return { fromBlock: '0', toBlock: '0', found: 0, credited: 0 };
      }

      let found = 0;
      let credited = 0;
      let lastFrom = '0';
      let lastTo = '0';
      for (const netKey of this.evm.evmKeys) {
        const r = await this.scanNetwork(netKey, addresses, byAddress).catch((err) => {
          this.logger.warn(`Indexer ${netKey}: ${(err as Error).message}`);
          return null;
        });
        if (!r) continue;
        found += r.found;
        credited += r.credited;
        lastFrom = r.fromBlock;
        lastTo = r.toBlock;
      }
      if (credited > 0) this.logger.log(`Indexer: ${credited} depósito(s) acreditados`);
      return { fromBlock: lastFrom, toBlock: lastTo, found, credited };
    } finally {
      this.scanning = false;
    }
  }

  /** Escaneo de UNA red EVM: avanza su cursor propio y acredita los confirmados. */
  private async scanNetwork(
    netKey: string,
    addresses: string[],
    byAddress: Map<string, string>,
  ): Promise<ScanResult> {
    const netCfg = this.evm.cfgOf(netKey);
    const usdc = netCfg.usdcAddress;
    const confirmations = netCfg.confirmations;

    const current = await this.evm.currentBlock(netKey);
    const toBlockMax = current - BigInt(confirmations);
    if (toBlockMax <= 0n) return { fromBlock: '0', toBlock: '0', found: 0, credited: 0 };

    const cursor = await this.cursors.findOne({ where: { network: netKey } });
    let fromBlock = cursor
      ? BigInt(cursor.lastBlock) + 1n
      : toBlockMax - BigInt(this.cfg.scanRange); // bootstrap: solo lo reciente
    if (fromBlock < 0n) fromBlock = 0n;
    let toBlock = toBlockMax;
    if (toBlock - fromBlock > BigInt(this.cfg.scanRange)) {
      toBlock = fromBlock + BigInt(this.cfg.scanRange);
    }
    if (toBlock < fromBlock) {
      return { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), found: 0, credited: 0 };
    }

    const transfers = await this.evm.getErc20TransfersTo(usdc, addresses, fromBlock, toBlock, netKey);
    const decimals = transfers.length ? await this.evm.tokenDecimals(usdc, netKey) : 6;

    let credited = 0;
    for (const t of transfers) {
      const userId = byAddress.get(t.to);
      if (!userId) continue;
      const amount = formatUnits(t.value, decimals);
      const ok = await this.creditDeposit(netKey, usdc, userId, t, amount);
      if (ok) credited++;
    }

    await this.cursors.save({ network: netKey, lastBlock: toBlock.toString() } as ChainCursorEntity);
    return {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      found: transfers.length,
      credited,
    };
  }

  /** Acredita UN depósito de forma atómica e idempotente. Devuelve false si ya estaba. */
  private async creditDeposit(
    network: string,
    tokenAddress: string,
    userId: string,
    t: { txHash: string; logIndex: number; value: bigint; blockNumber: bigint },
    amount: string,
  ): Promise<boolean> {
    const exists = await this.chainDeposits.findOne({
      where: { network, txHash: t.txHash, logIndex: t.logIndex },
    });
    if (exists) return false;

    try {
      await this.dataSource.transaction(async (manager) => {
        const asset = 'USDC';
        const custody = await this.ledger.getOrCreateAccount(
          'system',
          SYSTEM_CUSTODY,
          asset,
          manager,
        );
        const userAcc = await this.ledger.getOrCreateAccount('user', userId, asset, manager);
        const feeAcc = await this.ledger.getOrCreateAccount('system', FEE_ACCOUNT, asset, manager);

        // Comisión de recarga: el usuario recibe el neto; la comisión va a tesorería.
        const quote = this.fees.quoteDeposit(amount);

        const payment = manager.getRepository(PaymentEntity).create({
          id: randomUUID(),
          idempotencyKey: `deposit:${network}:${t.txHash}:${t.logIndex}`,
          userId,
          type: 'deposit',
          asset,
          amount: quote.net,
          status: 'completed',
          fromAccountId: custody.id,
          toAccountId: userAcc.id,
          counterparty: t.txHash,
          metadata: {
            network,
            txHash: t.txHash,
            logIndex: t.logIndex,
            grossAmount: amount,
            fee: quote.platformFee,
          },
        });
        await manager.getRepository(PaymentEntity).save(payment);

        // Doble entrada: custodia (activo on-chain) ↔ saldo neto del usuario + comisión.
        const entries = [
          { accountId: custody.id, direction: 'debit' as const, amount, asset },
          { accountId: userAcc.id, direction: 'credit' as const, amount: quote.net, asset },
        ];
        if (isPositive(quote.platformFee)) {
          entries.push({
            accountId: feeAcc.id,
            direction: 'credit' as const,
            amount: quote.platformFee,
            asset,
          });
        }
        await this.ledger.postJournal(manager, payment.id, entries);

        await manager.getRepository(ChainDepositEntity).save({
          id: randomUUID(),
          network,
          txHash: t.txHash,
          logIndex: t.logIndex,
          tokenAddress,
          asset,
          toAddress: '',
          userId,
          amount,
          blockNumber: t.blockNumber.toString(),
          paymentId: payment.id,
        } as ChainDepositEntity);
      });
      return true;
    } catch (e) {
      const code =
        (e as { code?: string; driverError?: { code?: string } })?.code ??
        (e as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '23505') return false; // ya acreditado por otro escaneo
      throw e;
    }
  }
}

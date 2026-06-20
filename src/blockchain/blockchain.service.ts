import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ChainConfig } from '../config/configuration';
import { BlockEntity } from '../database/entities/block.entity';
import { TransactionEntity } from '../database/entities/transaction.entity';
import { Block } from './domain/block';
import { Transaction } from './domain/transaction';

export interface SubmitTransactionInput {
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee?: number;
  timestamp: number;
  signature: string;
}

export interface ChainValidationResult {
  valid: boolean;
  height: number;
  errors: string[];
}

@Injectable()
export class BlockchainService implements OnModuleInit {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly chainCfg: ChainConfig;

  constructor(
    @InjectRepository(BlockEntity) private readonly blocks: Repository<BlockEntity>,
    @InjectRepository(TransactionEntity) private readonly txs: Repository<TransactionEntity>,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.chainCfg = config.getOrThrow<ChainConfig>('chain');
  }

  async onModuleInit(): Promise<void> {
    const count = await this.blocks.count();
    if (count === 0) {
      await this.createGenesisBlock();
    }
  }

  // ───────────────────────────── Génesis ─────────────────────────────

  private async createGenesisBlock(): Promise<void> {
    const txList: Transaction[] = [];

    // Premine opcional: acuña saldo inicial a una address para poder operar.
    if (this.chainCfg.genesisPremineAddress) {
      txList.push(
        new Transaction(null, this.chainCfg.genesisPremineAddress, 1_000_000, 0, Date.now()),
      );
    }

    const genesis = new Block(0, Date.now(), txList, '0'.repeat(64), this.chainCfg.difficulty);
    genesis.mine();
    await this.persistBlock(genesis, null);
    this.logger.log(`Bloque génesis creado (hash=${genesis.hash})`);
  }

  // ─────────────────────────── Consultas ───────────────────────────

  async getHeight(): Promise<number> {
    return this.blocks.count();
  }

  async getLatestBlock(): Promise<BlockEntity> {
    const block = await this.blocks.findOne({ where: {}, order: { index: 'DESC' } });
    if (!block) throw new NotFoundException('Cadena no inicializada');
    return block;
  }

  async getAllBlocks(): Promise<Array<BlockEntity & { transactions: TransactionEntity[] }>> {
    const blocks = await this.blocks.find({ order: { index: 'ASC' } });
    const result: Array<BlockEntity & { transactions: TransactionEntity[] }> = [];
    for (const block of blocks) {
      const transactions = await this.txs.find({ where: { blockIndex: block.index } });
      result.push({ ...block, transactions });
    }
    return result;
  }

  async getBlock(index: number): Promise<BlockEntity & { transactions: TransactionEntity[] }> {
    const block = await this.blocks.findOne({ where: { index } });
    if (!block) throw new NotFoundException(`Bloque ${index} no existe`);
    const transactions = await this.txs.find({ where: { blockIndex: index } });
    return { ...block, transactions };
  }

  async getPending(): Promise<TransactionEntity[]> {
    return this.txs.find({ where: { status: 'pending' }, order: { timestamp: 'ASC' } });
  }

  async getTransaction(id: string): Promise<TransactionEntity> {
    const tx = await this.txs.findOne({ where: { id } });
    if (!tx) throw new NotFoundException(`Transacción ${id} no existe`);
    return tx;
  }

  async getAddressTransactions(address: string): Promise<TransactionEntity[]> {
    return this.txs.find({
      where: [{ fromAddress: address }, { toAddress: address }],
      order: { timestamp: 'DESC' },
    });
  }

  // ─────────────────────────── Balances ───────────────────────────

  /** Saldo confirmado: solo transacciones ya minadas. */
  async getBalance(address: string): Promise<number> {
    return this.computeBalance(address, false);
  }

  /** Saldo disponible: confirmado menos lo bloqueado en transacciones pendientes. */
  async getAvailableBalance(address: string): Promise<number> {
    return this.computeBalance(address, true);
  }

  private async computeBalance(address: string, includePending: boolean): Promise<number> {
    const statuses = includePending ? ['mined', 'pending'] : ['mined'];
    const rows = await this.txs
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', { statuses })
      .andWhere('(t.fromAddress = :address OR t.toAddress = :address)', { address })
      .getMany();

    let balance = 0;
    for (const t of rows) {
      // Lo recibido solo cuenta si ya está minado (no se puede gastar lo pendiente entrante).
      if (t.toAddress === address && t.status === 'mined') balance += Number(t.amount);
      // Lo enviado se descuenta siempre (incluye pendiente: evita doble gasto en mempool).
      if (t.fromAddress === address) balance -= Number(t.amount) + Number(t.fee);
    }
    return balance;
  }

  // ─────────────────────── Envío de transacción ───────────────────────

  async submitTransaction(input: SubmitTransactionInput): Promise<TransactionEntity> {
    const tx = new Transaction(
      input.fromAddress,
      input.toAddress,
      input.amount,
      input.fee ?? 0,
      input.timestamp,
      input.signature,
    );

    if (!tx.isValid()) {
      throw new BadRequestException('Firma inválida o transacción mal formada');
    }

    const available = await this.getAvailableBalance(input.fromAddress);
    const cost = tx.amount + tx.fee;
    if (available < cost) {
      throw new BadRequestException(
        `Saldo insuficiente: disponible=${available}, requerido=${cost}`,
      );
    }

    return this.persistTransaction(tx, 'pending', null);
  }

  // ─────────────────────────── Minado ───────────────────────────

  /**
   * Mina todas las transacciones pendientes en un bloque nuevo, añadiendo una
   * transacción coinbase con la recompensa + las comisiones para el minero.
   * Operación transaccional: o se persiste el bloque completo, o nada.
   */
  async minePending(minerAddress: string): Promise<BlockEntity> {
    const pendingRows = await this.getPending();

    const pendingTxs = pendingRows.map(
      (r) =>
        new Transaction(
          r.fromAddress,
          r.toAddress,
          Number(r.amount),
          Number(r.fee),
          Number(r.timestamp),
          r.signature,
          r.id,
        ),
    );

    const totalFees = pendingTxs.reduce((acc, t) => acc + t.fee, 0);
    const coinbase = new Transaction(
      null,
      minerAddress,
      this.chainCfg.miningReward + totalFees,
      0,
      Date.now(),
    );

    const latest = await this.getLatestBlock();
    const block = new Block(
      latest.index + 1,
      Date.now(),
      [coinbase, ...pendingTxs],
      latest.hash,
      this.chainCfg.difficulty,
    );

    if (!block.hasValidTransactions()) {
      throw new BadRequestException('El bloque contiene transacciones inválidas');
    }

    const proof = block.mine();
    this.logger.log(
      `Bloque ${block.index} minado en ${proof.iterations} iteraciones (${proof.durationMs}ms), ` +
        `${pendingTxs.length} tx + coinbase`,
    );

    await this.dataSource.transaction(async (manager) => {
      const blockRepo = manager.getRepository(BlockEntity);
      const txRepo = manager.getRepository(TransactionEntity);

      await blockRepo.save(this.toBlockEntity(block, minerAddress));

      // coinbase
      await txRepo.save(this.toTxEntity(coinbase, 'mined', block.index));

      // marcar pendientes como minadas
      for (const r of pendingRows) {
        r.status = 'mined';
        r.blockIndex = block.index;
        await txRepo.save(r);
      }
    });

    return this.getLatestBlock();
  }

  // ─────────────────────── Validación de la cadena ───────────────────────

  async validateChain(): Promise<ChainValidationResult> {
    const blocks = await this.blocks.find({ order: { index: 'ASC' } });
    const errors: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const stored = blocks[i];
      const transactions = await this.txs.find({ where: { blockIndex: stored.index } });

      const domainTxs = transactions.map(
        (t) =>
          new Transaction(
            t.fromAddress,
            t.toAddress,
            Number(t.amount),
            Number(t.fee),
            Number(t.timestamp),
            t.signature,
            t.id,
          ),
      );

      const rebuilt = new Block(
        stored.index,
        Number(stored.timestamp),
        domainTxs,
        stored.previousHash,
        stored.difficulty,
      );
      rebuilt.nonce = stored.nonce;
      rebuilt.hash = rebuilt.calculateHash();

      if (rebuilt.hash !== stored.hash) {
        errors.push(`Bloque ${stored.index}: hash recalculado no coincide`);
      }
      if (stored.index > 0 && !rebuilt.hasValidProof()) {
        errors.push(`Bloque ${stored.index}: Proof of Work inválido`);
      }
      if (!rebuilt.hasValidTransactions()) {
        errors.push(`Bloque ${stored.index}: contiene transacciones con firma inválida`);
      }
      if (i > 0 && stored.previousHash !== blocks[i - 1].hash) {
        errors.push(`Bloque ${stored.index}: enlace previousHash roto`);
      }
    }

    return { valid: errors.length === 0, height: blocks.length, errors };
  }

  // ─────────────────────────── Mappers ───────────────────────────

  private async persistBlock(block: Block, minerAddress: string | null): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(BlockEntity).save(this.toBlockEntity(block, minerAddress));
      for (const t of block.transactions) {
        await manager
          .getRepository(TransactionEntity)
          .save(this.toTxEntity(t, 'mined', block.index));
      }
    });
  }

  private async persistTransaction(
    tx: Transaction,
    status: 'pending' | 'mined',
    blockIndex: number | null,
  ): Promise<TransactionEntity> {
    return this.txs.save(this.toTxEntity(tx, status, blockIndex));
  }

  private toBlockEntity(block: Block, minerAddress: string | null): BlockEntity {
    const entity = new BlockEntity();
    entity.index = block.index;
    entity.timestamp = String(block.timestamp);
    entity.previousHash = block.previousHash;
    entity.hash = block.hash;
    entity.merkleRoot = block.merkleRoot;
    entity.nonce = block.nonce;
    entity.difficulty = block.difficulty;
    entity.minerAddress = minerAddress;
    return entity;
  }

  private toTxEntity(
    tx: Transaction,
    status: 'pending' | 'mined',
    blockIndex: number | null,
  ): TransactionEntity {
    const entity = new TransactionEntity();
    entity.id = tx.id;
    entity.fromAddress = tx.fromAddress;
    entity.toAddress = tx.toAddress;
    entity.amount = tx.amount;
    entity.fee = tx.fee;
    entity.timestamp = String(tx.timestamp);
    entity.signature = tx.signature;
    entity.hash = tx.calculateHash();
    entity.status = status;
    entity.blockIndex = blockIndex;
    return entity;
  }
}

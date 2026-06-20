import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BlockchainService } from '../blockchain/blockchain.service';
import { MINING_QUEUE, MineBlockJobData } from './mining.constants';

/**
 * Worker que consume la cola de minado. Cada job mina un bloque con todas las
 * transacciones pendientes. Concurrencia 1 para evitar dos bloques compitiendo
 * por la misma punta de la cadena (forks) en este modelo de un solo nodo.
 */
@Processor(MINING_QUEUE, { concurrency: 1 })
export class MiningProcessor extends WorkerHost {
  private readonly logger = new Logger(MiningProcessor.name);

  constructor(private readonly blockchain: BlockchainService) {
    super();
  }

  async process(job: Job<MineBlockJobData>) {
    await job.updateProgress(10);
    const block = await this.blockchain.minePending(job.data.minerAddress);
    await job.updateProgress(100);

    return {
      index: block.index,
      hash: block.hash,
      previousHash: block.previousHash,
      nonce: block.nonce,
      difficulty: block.difficulty,
      minerAddress: block.minerAddress,
    };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completado (bloque ${job.returnvalue?.index})`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} falló: ${err.message}`);
  }
}

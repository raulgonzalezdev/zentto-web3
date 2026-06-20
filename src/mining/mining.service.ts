import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MINE_BLOCK_JOB, MINING_QUEUE, MineBlockJobData } from './mining.constants';

@Injectable()
export class MiningService {
  constructor(@InjectQueue(MINING_QUEUE) private readonly queue: Queue<MineBlockJobData>) {}

  /**
   * Encola un trabajo de minado. El cómputo de Proof of Work (intensivo en CPU)
   * se ejecuta fuera del ciclo request/response, en el worker BullMQ. Así la API
   * responde de inmediato y soporta carga sin bloquear el event loop.
   */
  async enqueueMining(minerAddress: string) {
    const job = await this.queue.add(
      MINE_BLOCK_JOB,
      { minerAddress },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return {
      jobId: job.id,
      status: 'queued',
      message: 'Minado encolado. Consulta el estado en GET /mining/jobs/:jobId',
    };
  }

  async getJobStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} no existe`);

    const state = await job.getState();
    return {
      jobId: job.id,
      state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }
}

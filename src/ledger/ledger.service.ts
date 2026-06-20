import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { cmpStr, fromBase, toBase } from '../common/money.util';
import { HoldEntity } from '../database/entities/hold.entity';
import { LedgerAccountEntity } from '../database/entities/ledger-account.entity';
import { LedgerEntryEntity } from '../database/entities/ledger-entry.entity';

export interface JournalLeg {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: string;
  asset: string;
}

export interface Balance {
  asset: string;
  balance: string;
  held: string;
  available: string;
}

/**
 * Núcleo contable de doble entrada. El saldo es SIEMPRE derivado de los asientos
 * (fuente de verdad), nunca un contador mutable. Cada journal debe cuadrar
 * (Σ débitos == Σ créditos) o se rechaza.
 */
@Injectable()
export class LedgerService {
  constructor(
    @InjectRepository(LedgerAccountEntity)
    private readonly accounts: Repository<LedgerAccountEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private mgr(manager?: EntityManager): EntityManager {
    return manager ?? this.dataSource.manager;
  }

  async getOrCreateAccount(
    ownerType: 'user' | 'system',
    ownerId: string,
    asset: string,
    manager?: EntityManager,
  ): Promise<LedgerAccountEntity> {
    const repo = this.mgr(manager).getRepository(LedgerAccountEntity);
    let acc = await repo.findOne({ where: { ownerType, ownerId, asset } });
    if (!acc) {
      acc = repo.create({ id: randomUUID(), ownerType, ownerId, asset });
      await repo.save(acc);
    }
    return acc;
  }

  /** Saldo contable = Σ créditos − Σ débitos. */
  async balanceOf(accountId: string, manager?: EntityManager): Promise<string> {
    const row = await this.mgr(manager)
      .getRepository(LedgerEntryEntity)
      .createQueryBuilder('e')
      .select(
        "COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END), 0)",
        'balance',
      )
      .where('e.accountId = :accountId', { accountId })
      .getRawOne<{ balance: string }>();
    return fromBase(toBase(row?.balance ?? '0'));
  }

  /** Suma de holds activos. */
  async heldOf(accountId: string, manager?: EntityManager): Promise<string> {
    const row = await this.mgr(manager)
      .getRepository(HoldEntity)
      .createQueryBuilder('h')
      .select('COALESCE(SUM(h.amount), 0)', 'held')
      .where('h.accountId = :accountId AND h.status = :status', { accountId, status: 'active' })
      .getRawOne<{ held: string }>();
    return fromBase(toBase(row?.held ?? '0'));
  }

  /** Disponible = saldo − holds activos. */
  async availableOf(accountId: string, manager?: EntityManager): Promise<string> {
    const [balance, held] = await Promise.all([
      this.balanceOf(accountId, manager),
      this.heldOf(accountId, manager),
    ]);
    return fromBase(toBase(balance) - toBase(held));
  }

  async balanceFor(ownerType: 'user' | 'system', ownerId: string, asset: string): Promise<Balance> {
    const acc = await this.getOrCreateAccount(ownerType, ownerId, asset);
    const [balance, held] = await Promise.all([this.balanceOf(acc.id), this.heldOf(acc.id)]);
    return { asset, balance, held, available: fromBase(toBase(balance) - toBase(held)) };
  }

  /**
   * Inserta un journal balanceado (≥2 legs). Debe correr dentro de una
   * transacción de BD (manager) para ser atómico con el resto del pago.
   */
  async postJournal(manager: EntityManager, paymentId: string, legs: JournalLeg[]): Promise<void> {
    if (legs.length < 2) throw new BadRequestException('Un journal requiere al menos 2 asientos');
    let debit = 0n;
    let credit = 0n;
    for (const leg of legs) {
      if (cmpStr(leg.amount, '0') <= 0) throw new BadRequestException('Importes deben ser > 0');
      if (leg.direction === 'debit') debit += toBase(leg.amount);
      else credit += toBase(leg.amount);
    }
    if (debit !== credit) {
      throw new BadRequestException('Journal descuadrado (Σ débitos ≠ Σ créditos)');
    }
    const repo = manager.getRepository(LedgerEntryEntity);
    for (const leg of legs) {
      await repo.save(
        repo.create({
          id: randomUUID(),
          paymentId,
          accountId: leg.accountId,
          direction: leg.direction,
          amount: leg.amount,
          asset: leg.asset,
        }),
      );
    }
  }

  // ─────────────────────────── Holds (dos fases) ───────────────────────────

  async createHold(
    manager: EntityManager,
    accountId: string,
    asset: string,
    amount: string,
    paymentId: string | null,
  ): Promise<HoldEntity> {
    const repo = manager.getRepository(HoldEntity);
    const hold = repo.create({
      id: randomUUID(),
      accountId,
      asset,
      amount,
      paymentId,
      status: 'active',
    });
    return repo.save(hold);
  }

  async setHoldStatus(
    manager: EntityManager,
    holdId: string,
    status: 'released' | 'committed',
  ): Promise<void> {
    await manager.getRepository(HoldEntity).update({ id: holdId }, { status });
  }
}

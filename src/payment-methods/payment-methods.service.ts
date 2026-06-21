import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { PaymentMethodEntity, PaymentMethodType } from '../database/entities/payment-method.entity';

export interface PaymentMethodInput {
  type: PaymentMethodType;
  label: string;
  bankName?: string;
  accountHolder?: string;
  idNumber?: string;
  phone?: string;
  accountNumber?: string;
}

/** Métodos de cobro del usuario (Pago Móvil / cuenta bancaria) para el P2P. */
@Injectable()
export class PaymentMethodsService {
  constructor(
    @InjectRepository(PaymentMethodEntity)
    private readonly repo: Repository<PaymentMethodEntity>,
  ) {}

  list(userId: string) {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** Lista pública (para mostrar en el order book de quien publica). */
  listByUser(userId: string) {
    return this.list(userId);
  }

  async create(userId: string, input: PaymentMethodInput) {
    const entity = this.repo.create({
      id: randomUUID(),
      userId,
      type: input.type,
      label: input.label,
      bankName: input.bankName ?? null,
      accountHolder: input.accountHolder ?? null,
      idNumber: input.idNumber ?? null,
      phone: input.phone ?? null,
      accountNumber: input.accountNumber ?? null,
    });
    return this.repo.save(entity);
  }

  async remove(userId: string, id: string) {
    const pm = await this.repo.findOne({ where: { id } });
    if (!pm) throw new NotFoundException('Método de pago no encontrado');
    if (pm.userId !== userId) throw new ForbiddenException('No es tu método de pago');
    await this.repo.remove(pm);
    return { ok: true };
  }
}

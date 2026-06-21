import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { AccountTokenEntity, AccountTokenType } from '../database/entities/account-token.entity';

/**
 * Emite y valida tokens de un solo uso para verificación de email y reset de
 * contraseña. El token plano (que va por email) nunca se persiste: en BD solo se
 * guarda su sha256. La validación compara hashes, no valores en claro.
 */
@Injectable()
export class AccountTokenService {
  constructor(
    @InjectRepository(AccountTokenEntity)
    private readonly tokens: Repository<AccountTokenEntity>,
  ) {}

  private hash(plain: string): string {
    return createHash('sha256').update(plain).digest('hex');
  }

  /**
   * Genera un token nuevo para `userId`/`type` y devuelve el valor **plano**
   * (para incrustar en el link del email). Invalida los tokens previos del mismo
   * tipo aún vigentes para que solo el último link funcione.
   */
  async issue(userId: string, type: AccountTokenType, ttlMs: number): Promise<string> {
    await this.tokens.update({ userId, type, usedAt: IsNull() }, { usedAt: new Date() });
    const plain = randomBytes(32).toString('base64url');
    const entity = this.tokens.create({
      id: randomUUID(),
      userId,
      type,
      tokenHash: this.hash(plain),
      expiresAt: new Date(Date.now() + ttlMs),
      usedAt: null,
    });
    await this.tokens.save(entity);
    return plain;
  }

  /**
   * Valida un token plano: existe, es del tipo esperado, no usado y no expirado.
   * Devuelve la entidad o null. NO lo marca como usado (eso lo hace `consume`).
   */
  async validate(plain: string, type: AccountTokenType): Promise<AccountTokenEntity | null> {
    if (!plain) return null;
    const record = await this.tokens.findOne({
      where: { tokenHash: this.hash(plain), type },
    });
    if (!record) return null;
    if (record.usedAt) return null;
    if (record.expiresAt.getTime() < Date.now()) return null;
    return record;
  }

  /** Marca el token como consumido (un solo uso). */
  async consume(id: string): Promise<void> {
    await this.tokens.update({ id }, { usedAt: new Date() });
  }
}

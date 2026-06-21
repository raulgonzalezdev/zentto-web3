import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';

export interface UserSearchResult {
  id: string;
  email: string;
  displayName: string | null;
  phone: string | null;
}

/** Búsqueda de usuarios y edición de perfil para el flujo de transferencias. */
@Injectable()
export class UsersService {
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  /** Busca destinatarios por correo, teléfono o id (excluye al propio usuario). */
  async search(query: string, selfId: string): Promise<UserSearchResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const like = `%${q.toLowerCase()}%`;
    const rows = await this.users
      .createQueryBuilder('u')
      .where('u.id != :selfId', { selfId })
      .andWhere(
        "(LOWER(u.email) LIKE :like OR LOWER(COALESCE(u.phone, '')) LIKE :like OR u.id = :exact)",
        { like, exact: q },
      )
      .orderBy('u.email', 'ASC')
      .limit(10)
      .getMany();
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      phone: u.phone,
    }));
  }

  /** Actualiza nombre y/o teléfono del propio usuario. */
  async updateProfile(
    userId: string,
    data: { displayName?: string; phone?: string },
  ): Promise<UserSearchResult> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    if (data.displayName !== undefined) user.displayName = data.displayName || null;
    if (data.phone !== undefined) user.phone = data.phone || null;
    await this.users.save(user);
    return { id: user.id, email: user.email, displayName: user.displayName, phone: user.phone };
  }
}

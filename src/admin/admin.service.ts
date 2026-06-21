import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LedgerConfig } from '../config/configuration';
import { CustodyService } from '../custody/custody.service';
import { KycVerificationEntity } from '../database/entities/kyc-verification.entity';
import { PaymentEntity } from '../database/entities/payment.entity';
import { UserEntity } from '../database/entities/user.entity';
import { EvmService } from '../evm/evm.service';
import { FEE_ACCOUNT, FeeService } from '../fees/fee.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class AdminService {
  private readonly assets: string[];

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(KycVerificationEntity)
    private readonly kyc: Repository<KycVerificationEntity>,
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    private readonly ledger: LedgerService,
    private readonly custody: CustodyService,
    private readonly evm: EvmService,
    private readonly fees: FeeService,
    config: ConfigService,
  ) {
    this.assets = config.getOrThrow<LedgerConfig>('ledger').assets;
  }

  /**
   * Cuenta MAESTRA de tesorería: comisiones acumuladas (ingresos de la plataforma)
   * por asset + dirección del hot wallet maestro y su saldo on-chain real. Es donde
   * vive el dinero que gana la app por cada operación.
   */
  async treasury() {
    const feeBalances = await Promise.all(
      this.assets.map(async (asset) => {
        const b = await this.ledger.balanceFor('system', FEE_ACCOUNT, asset);
        return { asset, balance: b.balance, available: b.available, held: b.held };
      }),
    );
    const custodyBalances = await Promise.all(
      this.assets.map(async (asset) => {
        const b = await this.ledger.balanceFor('system', 'custody', asset);
        return { asset, balance: b.balance };
      }),
    );

    let masterWallet: string | null = null;
    let onchain: unknown = null;
    if (this.custody.enabled) {
      masterWallet = this.custody.hotWalletAddress();
      onchain = await this.evm.getAddress(masterWallet).catch(() => null);
    }

    return {
      rates: this.fees.rates,
      feeRevenue: feeBalances, // ingresos por comisiones (lo que ganamos)
      custody: custodyBalances, // respaldo on-chain de los saldos de usuarios
      masterWallet, // billetera maestra (hot wallet de tesorería)
      onchain, // saldo real on-chain de la billetera maestra
    };
  }

  private async emailMap(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.users.find({ where: { id: In(userIds) }, select: ['id', 'email'] });
    return new Map(rows.map((u) => [u.id, u.email]));
  }

  /** TODAS las verificaciones KYC (no solo pendientes), con email. Filtro opcional. */
  async listKyc(status?: string) {
    const where = status ? { status: status as KycVerificationEntity['status'] } : {};
    const rows = await this.kyc.find({ where, order: { createdAt: 'DESC' }, take: 500 });
    const emails = await this.emailMap(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: emails.get(r.userId) ?? null,
      status: r.status,
      fullName: r.fullName,
      documentType: r.documentType,
      documentNumber: r.documentNumber,
      nationality: r.nationality,
      mrzValid: r.mrzValid,
      amlMatch: r.amlMatch,
      provider: r.provider,
      decisionReason: r.decisionReason,
      createdAt: r.createdAt,
    }));
  }

  /** Usuarios + estado KYC + saldos por asset. */
  async listUsers() {
    const users = await this.users.find({ order: { createdAt: 'DESC' }, take: 200 });
    const kycRows = await this.kyc.find({ where: { userId: In(users.map((u) => u.id)) } });
    const kycByUser = new Map(kycRows.map((k) => [k.userId, k.status]));
    return Promise.all(
      users.map(async (u) => {
        const balances = await Promise.all(
          this.assets.map(async (asset) => {
            const b = await this.ledger.balanceFor('user', u.id, asset);
            return { asset, available: b.available, balance: b.balance, held: b.held };
          }),
        );
        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          totpEnabled: u.totpEnabled,
          kycStatus: kycByUser.get(u.id) ?? 'not_started',
          balances,
          createdAt: u.createdAt,
        };
      }),
    );
  }

  /** TODOS los pagos del sistema (deposit/withdrawal/transfer/credit), con email. */
  async listPayments(type?: string, limit = 200) {
    const where = type ? { type: type as PaymentEntity['type'] } : {};
    const rows = await this.payments.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
    const emails = await this.emailMap(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: emails.get(r.userId) ?? null,
      type: r.type,
      asset: r.asset,
      amount: r.amount,
      status: r.status,
      counterparty: r.counterparty,
      failureReason: r.failureReason,
      createdAt: r.createdAt,
    }));
  }

  /** Cambia el rol de un usuario (solo admin). */
  async setRole(userId: string, role: 'user' | 'operator' | 'admin') {
    if (!['user', 'operator', 'admin'].includes(role)) {
      throw new BadRequestException('Rol inválido');
    }
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    user.role = role;
    await this.users.save(user);
    return { id: user.id, email: user.email, role: user.role };
  }

  /** Métricas del panel de operaciones. */
  async stats() {
    const [users, kycAll, payments] = await Promise.all([
      this.users.count(),
      this.kyc.find({ select: ['status'] }),
      this.payments.find({ select: ['type', 'status', 'asset', 'amount'] }),
    ]);
    const kycBy = (s: string) => kycAll.filter((k) => k.status === s).length;
    const payBy = (t: string) => payments.filter((p) => p.type === t).length;
    return {
      users,
      kyc: {
        approved: kycBy('approved'),
        pending: kycBy('pending') + kycBy('in_review'),
        rejected: kycBy('rejected'),
        total: kycAll.length,
      },
      payments: {
        total: payments.length,
        deposits: payBy('deposit'),
        withdrawals: payBy('withdrawal'),
        transfers: payBy('transfer'),
        withdrawalsProcessing: payments.filter(
          (p) => p.type === 'withdrawal' && p.status === 'processing',
        ).length,
      },
    };
  }
}

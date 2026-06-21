/* Mock ligero de @stellar/stellar-sdk para e2e: el flujo Stellar no se ejercita
 * en estos tests, y el paquete real es ESM que Jest no transforma. */
export class Keypair {
  static fromRawEd25519Seed(): Keypair {
    return new Keypair();
  }
  publicKey(): string {
    return 'GMOCKPLATFORMACCOUNT0000000000000000000000000000000000000';
  }
}

export class Asset {
  constructor(
    public code: string,
    public issuer: string,
  ) {}
}

export const Networks = { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'public' };

export const Memo = { text: (v: string) => ({ value: v }) };

export const Operation = { payment: (o: unknown) => o };

export class TransactionBuilder {
  addOperation(): this {
    return this;
  }
  addMemo(): this {
    return this;
  }
  setTimeout(): this {
    return this;
  }
  build(): { sign: () => void } {
    return { sign: () => undefined };
  }
}

class Server {
  payments() {
    return {
      forAccount: () => ({
        order: () => ({ limit: () => ({ call: async () => ({ records: [] }) }) }),
      }),
    };
  }
  transactions() {
    return { transaction: () => ({ call: async () => null }) };
  }
  async loadAccount() {
    return {};
  }
  async fetchBaseFee() {
    return 100;
  }
  async submitTransaction() {
    return { hash: 'mock-stellar-hash' };
  }
}

export const Horizon = { Server };
export class MuxedAccount {}

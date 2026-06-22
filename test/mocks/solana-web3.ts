/* Mock ligero de @solana/web3.js para e2e: el flujo Solana no se ejercita en estos
 * tests y el paquete real es ESM (vía rpc-websockets/uuid) que Jest no transforma. */
export class PublicKey {
  constructor(private readonly value: string) {}
  toBase58(): string {
    return this.value;
  }
  toString(): string {
    return this.value;
  }
}

export class Keypair {
  static fromSeed(): Keypair {
    return new Keypair();
  }
  get publicKey(): PublicKey {
    return new PublicKey('SoLMockPubKey1111111111111111111111111111111');
  }
}

export class Connection {
  async getSignaturesForAddress(): Promise<Array<{ signature: string; err: unknown }>> {
    return [];
  }
  async getParsedTransaction(): Promise<null> {
    return null;
  }
  async getBalance(): Promise<number> {
    return 0;
  }
}

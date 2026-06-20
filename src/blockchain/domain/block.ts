import { merkleRoot, sha256 } from '../../common/crypto.util';
import { Transaction } from './transaction';

/**
 * Bloque de dominio con Proof of Work. El minado busca un `nonce` tal que el
 * hash empiece por `difficulty` ceros (target simplificado tipo Bitcoin).
 */
export class Block {
  public hash: string;
  public nonce = 0;
  public readonly merkleRoot: string;

  constructor(
    public readonly index: number,
    public readonly timestamp: number,
    public readonly transactions: Transaction[],
    public readonly previousHash: string,
    public readonly difficulty: number,
  ) {
    this.merkleRoot = merkleRoot(transactions.map((t) => t.calculateHash()));
    this.hash = this.calculateHash();
  }

  calculateHash(): string {
    return sha256(
      `${this.index}|${this.previousHash}|${this.timestamp}|${this.merkleRoot}|${this.nonce}|${this.difficulty}`,
    );
  }

  /** El objetivo es un hash con `difficulty` ceros a la izquierda. */
  private meetsTarget(): boolean {
    return this.hash.startsWith('0'.repeat(this.difficulty));
  }

  /** Proof of Work: itera el nonce hasta cumplir el objetivo. */
  mine(): { iterations: number; durationMs: number } {
    const start = Date.now();
    let iterations = 0;
    while (!this.meetsTarget()) {
      this.nonce++;
      iterations++;
      this.hash = this.calculateHash();
    }
    return { iterations, durationMs: Date.now() - start };
  }

  hasValidTransactions(): boolean {
    return this.transactions.every((t) => t.isValid());
  }

  hasValidProof(): boolean {
    return this.meetsTarget() && this.hash === this.calculateHash();
  }
}

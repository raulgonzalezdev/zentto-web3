import {
  derivePublicKey,
  randomId,
  sha256,
  signHash,
  verifySignature,
} from '../../common/crypto.util';

/**
 * Transacción de dominio (independiente de la persistencia). Encapsula el
 * cálculo de su hash, la firma y la verificación.
 */
export class Transaction {
  public readonly id: string;

  constructor(
    public readonly fromAddress: string | null,
    public readonly toAddress: string,
    public readonly amount: number,
    public readonly fee: number,
    public readonly timestamp: number,
    public signature: string | null = null,
    id?: string,
  ) {
    this.id = id ?? randomId();
  }

  /** Hash determinista sobre los campos firmables. */
  calculateHash(): string {
    return sha256(
      `${this.fromAddress ?? 'COINBASE'}|${this.toAddress}|${this.amount}|${this.fee}|${this.timestamp}`,
    );
  }

  /** Firma la transacción con la clave privada del emisor. */
  sign(privateKey: string): void {
    if (this.fromAddress === null) {
      throw new Error('No se puede firmar una transacción coinbase');
    }
    if (derivePublicKey(privateKey) !== this.fromAddress) {
      throw new Error('La clave privada no corresponde a la address del emisor');
    }
    this.signature = signHash(privateKey, this.calculateHash());
  }

  /**
   * Reglas de validez:
   * - coinbase (fromAddress === null): siempre válida (la crea el sistema).
   * - resto: requiere firma que verifique contra la address del emisor.
   */
  isValid(): boolean {
    if (this.fromAddress === null) return true;
    if (!this.signature) return false;
    if (this.amount <= 0 || this.fee < 0) return false;
    if (this.fromAddress === this.toAddress) return false;
    return verifySignature(this.fromAddress, this.calculateHash(), this.signature);
  }
}

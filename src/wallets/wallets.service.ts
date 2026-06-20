import { Injectable } from '@nestjs/common';
import { derivePublicKey, generateKeyPair } from '../common/crypto.util';
import { Transaction } from '../blockchain/domain/transaction';
import { BlockchainService } from '../blockchain/blockchain.service';
import { SignTransactionDto } from './dto/sign-transaction.dto';

export interface CreatedWallet {
  address: string;
  publicKey: string;
  privateKey: string;
  warning: string;
}

/**
 * Payload listo para enviarse tal cual a POST /transactions (coincide con
 * SubmitTransactionDto: sin campos extra que el ValidationPipe rechace).
 */
export interface SignedTransactionPayload {
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee: number;
  timestamp: number;
  signature: string;
}

@Injectable()
export class WalletsService {
  constructor(private readonly blockchain: BlockchainService) {}

  /**
   * Genera un par de claves. La clave privada se devuelve UNA sola vez y no se
   * persiste en ningún lado (la API es stateless respecto a claves privadas).
   */
  createWallet(): CreatedWallet {
    const { privateKey, publicKey } = generateKeyPair();
    return {
      address: publicKey,
      publicKey,
      privateKey,
      warning: 'Guarda la clave privada de forma segura. No se almacena ni se puede recuperar.',
    };
  }

  async getBalance(
    address: string,
  ): Promise<{ address: string; confirmed: number; available: number }> {
    const [confirmed, available] = await Promise.all([
      this.blockchain.getBalance(address),
      this.blockchain.getAvailableBalance(address),
    ]);
    return { address, confirmed, available };
  }

  /**
   * Firma una transacción del lado del servidor (solo demo). Devuelve el payload
   * listo para enviarse a POST /transactions.
   */
  sign(dto: SignTransactionDto): SignedTransactionPayload {
    const fromAddress = derivePublicKey(dto.privateKey);
    const timestamp = dto.timestamp ?? Date.now();

    const tx = new Transaction(fromAddress, dto.toAddress, dto.amount, dto.fee ?? 0, timestamp);
    tx.sign(dto.privateKey);

    return {
      fromAddress,
      toAddress: dto.toAddress,
      amount: dto.amount,
      fee: dto.fee ?? 0,
      timestamp,
      signature: tx.signature as string,
    };
  }
}

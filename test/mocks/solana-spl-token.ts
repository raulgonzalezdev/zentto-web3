/* Mock ligero de @solana/spl-token para e2e (paquete ESM no transformado por Jest).
 * Devuelve una ATA determinista; el flujo Solana no se ejercita en estos tests. */
import { PublicKey } from './solana-web3';

export async function getAssociatedTokenAddress(): Promise<PublicKey> {
  return new PublicKey('AtaMock11111111111111111111111111111111111111');
}

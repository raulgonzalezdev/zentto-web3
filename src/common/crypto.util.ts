import { createHash, randomBytes } from 'crypto';
import { ec as EC } from 'elliptic';

/**
 * Primitivas criptográficas de la cadena.
 *
 * - Hashing: SHA-256 (igual que Bitcoin a nivel de bloque).
 * - Firmas: curva secp256k1 (la misma de Bitcoin/Ethereum).
 *
 * En esta implementación didáctica la "address" de una wallet ES su clave
 * pública comprimida en hex. Esto simplifica la verificación de firmas: para
 * validar una transacción basta con reconstruir la clave pública desde la
 * propia address del emisor. En una cadena real la address es un hash de la
 * clave pública (p.ej. RIPEMD160(SHA256(pubkey))) — aquí se omite por claridad.
 */
const secp256k1 = new EC('secp256k1');

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface KeyPair {
  privateKey: string;
  publicKey: string; // == address
}

export function generateKeyPair(): KeyPair {
  const key = secp256k1.genKeyPair();
  return {
    privateKey: key.getPrivate('hex'),
    publicKey: key.getPublic(true, 'hex'),
  };
}

export function derivePublicKey(privateKey: string): string {
  const key = secp256k1.keyFromPrivate(privateKey, 'hex');
  return key.getPublic(true, 'hex');
}

/**
 * Firma el hash de una transacción con la clave privada del emisor.
 * Devuelve la firma DER en hex.
 */
export function signHash(privateKey: string, hash: string): string {
  const key = secp256k1.keyFromPrivate(privateKey, 'hex');
  return key.sign(hash).toDER('hex');
}

/**
 * Verifica que `signature` corresponde a `hash` firmado por el dueño de
 * `publicKey` (la address del emisor).
 */
export function verifySignature(publicKey: string, hash: string, signature: string): boolean {
  try {
    const key = secp256k1.keyFromPublic(publicKey, 'hex');
    return key.verify(hash, signature);
  } catch {
    return false;
  }
}

/**
 * Merkle root simple sobre los hashes de transacción de un bloque.
 * Reduce los hashes por pares hasta obtener una única raíz; si el número de
 * nodos es impar, se duplica el último (igual que Bitcoin).
 */
export function merkleRoot(txHashes: string[]): string {
  if (txHashes.length === 0) return sha256('');
  let level = [...txHashes];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(sha256(left + right));
    }
    level = next;
  }
  return level[0];
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

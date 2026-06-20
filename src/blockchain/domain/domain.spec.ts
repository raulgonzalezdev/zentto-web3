import { generateKeyPair } from '../../common/crypto.util';
import { Block } from './block';
import { Transaction } from './transaction';

describe('Transaction (dominio)', () => {
  it('una transacción firmada es válida', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const to = generateKeyPair().publicKey;
    const tx = new Transaction(publicKey, to, 100, 1, Date.now());
    tx.sign(privateKey);
    expect(tx.isValid()).toBe(true);
  });

  it('una transacción sin firma no es válida', () => {
    const { publicKey } = generateKeyPair();
    const to = generateKeyPair().publicKey;
    const tx = new Transaction(publicKey, to, 100, 1, Date.now());
    expect(tx.isValid()).toBe(false);
  });

  it('una coinbase (sin emisor) es válida sin firma', () => {
    const to = generateKeyPair().publicKey;
    const tx = new Transaction(null, to, 50, 0, Date.now());
    expect(tx.isValid()).toBe(true);
  });

  it('rechaza firmar con clave que no corresponde al emisor', () => {
    const owner = generateKeyPair();
    const other = generateKeyPair();
    const to = generateKeyPair().publicKey;
    const tx = new Transaction(owner.publicKey, to, 100, 1, Date.now());
    expect(() => tx.sign(other.privateKey)).toThrow();
  });
});

describe('Block (dominio) — Proof of Work', () => {
  it('mina un bloque que cumple el objetivo de dificultad', () => {
    const difficulty = 2;
    const block = new Block(1, Date.now(), [], '0'.repeat(64), difficulty);
    block.mine();
    expect(block.hash.startsWith('0'.repeat(difficulty))).toBe(true);
    expect(block.hasValidProof()).toBe(true);
  });

  it('detecta manipulación: cambiar el nonce invalida el proof', () => {
    const block = new Block(1, Date.now(), [], '0'.repeat(64), 2);
    block.mine();
    block.nonce += 1; // manipulación sin recalcular hash
    expect(block.hasValidProof()).toBe(false);
  });
});

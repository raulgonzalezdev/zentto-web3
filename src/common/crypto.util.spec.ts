import {
  derivePublicKey,
  generateKeyPair,
  merkleRoot,
  sha256,
  signHash,
  verifySignature,
} from './crypto.util';

describe('crypto.util', () => {
  it('sha256 es determinista', () => {
    expect(sha256('zentto')).toEqual(sha256('zentto'));
    expect(sha256('a')).not.toEqual(sha256('b'));
  });

  it('genera pares de claves y deriva la pública desde la privada', () => {
    const { privateKey, publicKey } = generateKeyPair();
    expect(derivePublicKey(privateKey)).toEqual(publicKey);
  });

  it('firma y verifica un hash correctamente', () => {
    const { privateKey, publicKey } = generateKeyPair();
    const hash = sha256('mensaje');
    const sig = signHash(privateKey, hash);
    expect(verifySignature(publicKey, hash, sig)).toBe(true);
  });

  it('rechaza una firma de otra clave', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const hash = sha256('mensaje');
    const sig = signHash(a.privateKey, hash);
    expect(verifySignature(b.publicKey, hash, sig)).toBe(false);
  });

  it('calcula una merkle root estable', () => {
    const hashes = ['a', 'b', 'c'].map(sha256);
    expect(merkleRoot(hashes)).toEqual(merkleRoot(hashes));
    expect(merkleRoot(hashes)).not.toEqual(merkleRoot(['a', 'b'].map(sha256)));
  });
});

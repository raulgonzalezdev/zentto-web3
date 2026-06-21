/* Mock ligero de tronweb para e2e: el flujo Tron no se ejercita en estos tests,
 * y el paquete real es ESM que Jest no transforma. Solo exporta lo que se importa. */
export class TronWeb {
  static fromMnemonic(): { address: string; privateKey: string } {
    return { address: 'TMockAddress0000000000000000000000', privateKey: '0'.repeat(64) };
  }
  trx = { getTransactionInfo: async () => null };
  contract() {
    return { at: async () => ({ transfer: () => ({ send: async () => 'mock-txid' }) }) };
  }
}

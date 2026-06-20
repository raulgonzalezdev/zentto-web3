/** Eventos internos (event bus) que emite la cadena al minar/recibir tx localmente. */
export const CHAIN_EVENTS = {
  BLOCK_MINED: 'chain.block_mined',
  TX_ADDED: 'chain.tx_added',
} as const;

/**
 * Protocolo de gossip P2P. Mensajes JSON intercambiados por WebSocket entre nodos.
 */
export enum P2pMessageType {
  HELLO = 'HELLO', // handshake: nombre + altura de cadena
  GET_CHAIN = 'GET_CHAIN', // pedir la cadena completa
  CHAIN = 'CHAIN', // responder con la cadena completa (para sync / resolución de forks)
  NEW_BLOCK = 'NEW_BLOCK', // anunciar un bloque recién minado
  NEW_TRANSACTION = 'NEW_TRANSACTION', // anunciar una transacción del mempool
  GET_PEERS = 'GET_PEERS', // pedir la lista de peers conocidos
  PEERS = 'PEERS', // responder con URLs de peers
}

export interface TransactionSnapshot {
  id: string;
  fromAddress: string | null;
  toAddress: string;
  amount: number;
  fee: number;
  timestamp: number;
  signature: string | null;
}

export interface BlockSnapshot {
  index: number;
  timestamp: number;
  previousHash: string;
  hash: string;
  merkleRoot: string;
  nonce: number;
  difficulty: number;
  minerAddress: string | null;
  transactions: TransactionSnapshot[];
}

export interface P2pMessage {
  type: P2pMessageType;
  nodeName?: string;
  height?: number;
  block?: BlockSnapshot;
  transaction?: TransactionSnapshot;
  chain?: BlockSnapshot[];
  peers?: string[];
}

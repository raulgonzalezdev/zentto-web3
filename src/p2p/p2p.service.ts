import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { BlockchainService } from '../blockchain/blockchain.service';
import { P2pConfig } from '../config/configuration';
import {
  BlockSnapshot,
  CHAIN_EVENTS,
  P2pMessage,
  P2pMessageType,
  TransactionSnapshot,
} from './p2p.types';

/**
 * Nodo P2P. Cada instancia:
 * - levanta un servidor WebSocket (acepta peers entrantes),
 * - se conecta a los peers configurados (PEERS) como cliente,
 * - hace gossip de transacciones y bloques nuevos (con dedup),
 * - sincroniza la cadena al conectar y resuelve forks por cadena más larga.
 *
 * Desacople: las acciones LOCALES (minar / enviar tx) llegan por el event bus
 * (@OnEvent) y se difunden; lo recibido de la red se aplica vía BlockchainService
 * y se re-difunde a los demás peers (gossip).
 */
@Injectable()
export class P2pService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(P2pService.name);
  private readonly cfg: P2pConfig;

  private server?: WebSocketServer;
  private readonly sockets = new Map<WebSocket, string>(); // socket -> url ('inbound' si entrante)
  private readonly outboundUrls = new Set<string>();
  private readonly knownPeers = new Set<string>();
  private readonly seenBlocks = new Set<string>(); // hashes vistos
  private readonly seenTxs = new Set<string>(); // ids vistos
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly blockchain: BlockchainService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<P2pConfig>('p2p');
    this.cfg.peers.forEach((p) => this.knownPeers.add(p));
  }

  onModuleInit(): void {
    if (!this.cfg.enabled) {
      this.logger.log('P2P deshabilitado (P2P_ENABLED=false) — nodo en modo standalone');
      return;
    }
    this.startServer();
    this.connectToPeers();
    this.reconnectTimer = setInterval(() => this.connectToPeers(), 15000);
  }

  onApplicationShutdown(): void {
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.sockets.forEach((_url, sock) => sock.close());
    this.server?.close();
  }

  // ─────────────────────────── estado ───────────────────────────

  status() {
    return {
      enabled: this.cfg.enabled,
      nodeName: this.cfg.nodeName,
      port: this.cfg.port,
      connectedPeers: this.sockets.size,
      knownPeers: [...this.knownPeers],
      seenBlocks: this.seenBlocks.size,
      seenTxs: this.seenTxs.size,
    };
  }

  /** Conecta a un peer en runtime (para añadir nodos sin reiniciar). */
  addPeer(url: string): void {
    this.knownPeers.add(url);
    this.connectToPeers();
  }

  // ─────────────────────────── servidor / clientes ───────────────────────────

  private startServer(): void {
    this.server = new WebSocketServer({ port: this.cfg.port });
    this.server.on('connection', (ws) => this.registerSocket(ws, 'inbound'));
    this.server.on('error', (err) => this.logger.error(`Servidor P2P: ${err.message}`));
    this.logger.log(`Nodo P2P "${this.cfg.nodeName}" escuchando en ws://0.0.0.0:${this.cfg.port}`);
  }

  private connectToPeers(): void {
    for (const url of this.knownPeers) {
      if (this.outboundUrls.has(url)) continue;
      try {
        const ws = new WebSocket(url);
        this.outboundUrls.add(url);
        ws.on('open', () => {
          this.logger.log(`Conectado a peer ${url}`);
          this.registerSocket(ws, url);
        });
        ws.on('error', () => {
          this.outboundUrls.delete(url);
        });
        ws.on('close', () => {
          this.outboundUrls.delete(url);
        });
      } catch {
        this.outboundUrls.delete(url);
      }
    }
  }

  private registerSocket(ws: WebSocket, url: string): void {
    this.sockets.set(ws, url);
    ws.on('message', (data) => void this.handleMessage(ws, data));
    ws.on('close', () => this.sockets.delete(ws));
    ws.on('error', () => this.sockets.delete(ws));
    void this.sendHello(ws);
  }

  private async sendHello(ws: WebSocket): Promise<void> {
    const height = await this.blockchain.getHeight();
    this.send(ws, { type: P2pMessageType.HELLO, nodeName: this.cfg.nodeName, height });
    this.send(ws, { type: P2pMessageType.GET_PEERS });
  }

  // ─────────────────────────── mensajes ───────────────────────────

  private async handleMessage(ws: WebSocket, raw: RawData): Promise<void> {
    let msg: P2pMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    try {
      switch (msg.type) {
        case P2pMessageType.HELLO:
          await this.onHello(ws, msg.height ?? 0);
          break;
        case P2pMessageType.GET_CHAIN:
          this.send(ws, {
            type: P2pMessageType.CHAIN,
            chain: await this.blockchain.getChainSnapshot(),
          });
          break;
        case P2pMessageType.CHAIN:
          await this.onChain(msg.chain ?? []);
          break;
        case P2pMessageType.NEW_BLOCK:
          if (msg.block) await this.onNewBlock(ws, msg.block);
          break;
        case P2pMessageType.NEW_TRANSACTION:
          if (msg.transaction) await this.onNewTransaction(ws, msg.transaction);
          break;
        case P2pMessageType.GET_PEERS:
          this.send(ws, { type: P2pMessageType.PEERS, peers: [...this.knownPeers] });
          break;
        case P2pMessageType.PEERS:
          (msg.peers ?? []).forEach((p) => this.knownPeers.add(p));
          this.connectToPeers();
          break;
      }
    } catch (err) {
      this.logger.warn(`Error procesando ${msg.type}: ${(err as Error).message}`);
    }
  }

  private async onHello(ws: WebSocket, peerHeight: number): Promise<void> {
    const myHeight = await this.blockchain.getHeight();
    if (peerHeight > myHeight) {
      // El peer va más adelantado: pedimos su cadena para sincronizar.
      this.send(ws, { type: P2pMessageType.GET_CHAIN });
    }
  }

  private async onChain(chain: BlockSnapshot[]): Promise<void> {
    const res = await this.blockchain.replaceChain(chain);
    if (res.status === 'replaced') {
      this.logger.log(`Cadena reemplazada por una más larga (altura ${chain.length})`);
      // Marca los bloques como vistos para no re-pedirlos.
      chain.forEach((b) => this.seenBlocks.add(b.hash));
    }
  }

  private async onNewBlock(from: WebSocket, block: BlockSnapshot): Promise<void> {
    if (this.seenBlocks.has(block.hash)) return;
    this.seenBlocks.add(block.hash);

    const res = await this.blockchain.appendExternalBlock(block);
    if (res.status === 'accepted') {
      this.logger.log(`Bloque ${block.index} aceptado de la red; re-difundiendo`);
      this.broadcast({ type: P2pMessageType.NEW_BLOCK, block }, from);
    } else if (res.status === 'mismatch') {
      // Hueco o fork: pedimos la cadena completa al emisor para reconciliar.
      this.send(from, { type: P2pMessageType.GET_CHAIN });
    }
  }

  private async onNewTransaction(from: WebSocket, tx: TransactionSnapshot): Promise<void> {
    if (this.seenTxs.has(tx.id)) return;
    this.seenTxs.add(tx.id);

    const res = await this.blockchain.addExternalTransaction(tx);
    if (res.status === 'accepted') {
      this.broadcast({ type: P2pMessageType.NEW_TRANSACTION, transaction: tx }, from);
    }
  }

  // ─────────────────── difusión desde acciones locales ───────────────────

  @OnEvent(CHAIN_EVENTS.BLOCK_MINED)
  onLocalBlockMined(block: BlockSnapshot): void {
    this.seenBlocks.add(block.hash);
    this.broadcast({ type: P2pMessageType.NEW_BLOCK, block });
  }

  @OnEvent(CHAIN_EVENTS.TX_ADDED)
  onLocalTxAdded(tx: TransactionSnapshot): void {
    this.seenTxs.add(tx.id);
    this.broadcast({ type: P2pMessageType.NEW_TRANSACTION, transaction: tx });
  }

  // ─────────────────────────── envío ───────────────────────────

  private send(ws: WebSocket, msg: P2pMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: P2pMessage, except?: WebSocket): void {
    const payload = JSON.stringify(msg);
    this.sockets.forEach((_url, sock) => {
      if (sock !== except && sock.readyState === WebSocket.OPEN) sock.send(payload);
    });
  }
}

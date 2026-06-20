import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionEntity } from '../database/entities/transaction.entity';

export interface GraphNode {
  address: string;
  inDegree: number;
  outDegree: number;
  volumeIn: number;
  volumeOut: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  volume: number;
  count: number;
}

export interface TransferGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AddressRelations {
  address: string;
  inbound: GraphEdge[];
  outbound: GraphEdge[];
  uniqueCounterparties: number;
}

/**
 * Análisis del ecosistema on-chain. Construye el grafo dirigido de
 * transferencias y deriva métricas útiles para investigación:
 * - relaciones directas de una address (quién le envía / a quién envía),
 * - hubs tipo exchange (alto grado de entrada y salida),
 * - rutas de fondos entre dos addresses (trazabilidad).
 *
 * El nombre "cross-chain" refleja el enfoque del puesto: explorar relaciones
 * entre cuentas e intercambios. El modelo es genérico y extensible a varias
 * cadenas añadiendo un discriminante de red por transacción.
 */
@Injectable()
export class CrossChainService {
  constructor(
    @InjectRepository(TransactionEntity)
    private readonly txs: Repository<TransactionEntity>,
  ) {}

  private async minedTransfers(): Promise<TransactionEntity[]> {
    // Solo transferencias reales entre addresses (se excluyen coinbase).
    return this.txs
      .createQueryBuilder('t')
      .where('t.status = :status', { status: 'mined' })
      .andWhere('t.fromAddress IS NOT NULL')
      .getMany();
  }

  async buildGraph(): Promise<TransferGraph> {
    const transfers = await this.minedTransfers();
    const nodes = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();

    const ensureNode = (address: string): GraphNode => {
      let node = nodes.get(address);
      if (!node) {
        node = { address, inDegree: 0, outDegree: 0, volumeIn: 0, volumeOut: 0 };
        nodes.set(address, node);
      }
      return node;
    };

    for (const t of transfers) {
      const from = t.fromAddress as string;
      const to = t.toAddress;
      const amount = Number(t.amount);

      const fromNode = ensureNode(from);
      const toNode = ensureNode(to);
      fromNode.outDegree += 1;
      fromNode.volumeOut += amount;
      toNode.inDegree += 1;
      toNode.volumeIn += amount;

      const key = `${from}->${to}`;
      const edge = edgeMap.get(key);
      if (edge) {
        edge.volume += amount;
        edge.count += 1;
      } else {
        edgeMap.set(key, { from, to, volume: amount, count: 1 });
      }
    }

    return { nodes: [...nodes.values()], edges: [...edgeMap.values()] };
  }

  async relations(address: string): Promise<AddressRelations> {
    const { edges } = await this.buildGraph();
    const inbound = edges.filter((e) => e.to === address);
    const outbound = edges.filter((e) => e.from === address);
    const counterparties = new Set<string>([
      ...inbound.map((e) => e.from),
      ...outbound.map((e) => e.to),
    ]);
    return {
      address,
      inbound,
      outbound,
      uniqueCounterparties: counterparties.size,
    };
  }

  /**
   * Detecta hubs tipo exchange: addresses con alto grado de entrada Y de salida,
   * que actúan como puntos de concentración/redistribución de fondos.
   */
  async detectHubs(minDegree = 5): Promise<GraphNode[]> {
    const { nodes } = await this.buildGraph();
    return nodes
      .filter((n) => n.inDegree >= minDegree && n.outDegree >= minDegree)
      .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree));
  }

  /**
   * Traza una ruta de fondos entre dos addresses recorriendo el grafo (BFS).
   * Útil para seguir el flujo del dinero en una investigación.
   */
  async traceFunds(from: string, to: string, maxHops = 6): Promise<string[] | null> {
    const { edges } = await this.buildGraph();
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.from) ?? [];
      list.push(e.to);
      adjacency.set(e.from, list);
    }

    const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];
    const visited = new Set<string>([from]);

    while (queue.length) {
      const { node, path } = queue.shift() as { node: string; path: string[] };
      if (node === to) return path;
      if (path.length > maxHops) continue;
      for (const next of adjacency.get(node) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ node: next, path: [...path, next] });
        }
      }
    }
    return null;
  }
}

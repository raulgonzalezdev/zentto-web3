import { Injectable, Logger } from '@nestjs/common';

export interface AmlHit {
  name: string;
  list: string;
  score: number; // 0..1
}

export interface AmlResult {
  match: boolean;
  hits: AmlHit[];
}

/**
 * Screening de sanciones contra la lista OFAC SDN — implementación PROPIA.
 *
 * La lista SDN del Tesoro de EE.UU. es PÚBLICA y gratuita (descarga sdn.csv de
 * https://sanctionslist.ofac.treas.gov). En dev usamos una muestra embebida; en
 * producción `loadList()` cargaría el CSV completo (y se refrescaría a diario).
 *
 * El matching normaliza (mayúsculas, sin acentos/puntuación) y compara por tokens:
 * coincidencia exacta = 1.0; todos los tokens del nombre buscado presentes = 0.85.
 * Esto es construible en casa: dato público + algoritmo determinista, sin adversario.
 */
@Injectable()
export class AmlScreeningService {
  private readonly logger = new Logger(AmlScreeningService.name);

  // Muestra (nombres reales de la SDN, dato público). En prod: lista completa.
  private readonly list: Array<{ name: string; list: string }> = [
    { name: 'OSAMA BIN LADEN', list: 'OFAC-SDN' },
    { name: 'JOAQUIN GUZMAN LOERA', list: 'OFAC-SDN' },
    { name: 'VIKTOR BOUT', list: 'OFAC-SDN' },
    { name: 'EZEDIN ABDEL AAL', list: 'OFAC-SDN' },
  ];

  private normalized = this.list.map((e) => ({ ...e, tokens: this.tokens(e.name) }));

  private tokens(name: string): string[] {
    return name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // quita diacríticos combinantes
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /** Carga la lista completa (prod). Aquí queda el punto de extensión. */
  loadList(entries: Array<{ name: string; list: string }>): void {
    this.normalized = entries.map((e) => ({ ...e, tokens: this.tokens(e.name) }));
    this.logger.log(`Lista de sanciones cargada: ${entries.length} entradas`);
  }

  screen(fullName: string): AmlResult {
    const query = this.tokens(fullName);
    if (query.length === 0) return { match: false, hits: [] };
    const hits: AmlHit[] = [];
    for (const entry of this.normalized) {
      const exact = entry.tokens.join(' ') === query.join(' ');
      const allPresent = query.every((t) => entry.tokens.includes(t));
      if (exact) hits.push({ name: entry.name, list: entry.list, score: 1 });
      else if (allPresent && query.length >= 2)
        hits.push({ name: entry.name, list: entry.list, score: 0.85 });
    }
    return { match: hits.length > 0, hits };
  }
}

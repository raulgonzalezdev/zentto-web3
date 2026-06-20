import { createHmac, timingSafeEqual } from 'crypto';

type Json = Record<string, unknown>;

/** Normaliza floats enteros (1.0 → 1) para igualar el encoding del backend de Didit. */
function shortenFloats(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(shortenFloats);
  if (data && typeof data === 'object') {
    const out: Json = {};
    for (const [k, v] of Object.entries(data)) out[k] = shortenFloats(v);
    return out;
  }
  if (typeof data === 'number' && !Number.isInteger(data) && data === Math.floor(data)) {
    return Math.floor(data);
  }
  return data;
}

/** JSON con claves ordenadas (equivale a json.dumps(sort_keys=True) del backend). */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Json).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Json)[k])).join(',') +
      '}'
    );
  }
  return JSON.stringify(obj);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf-8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Verifica la firma de un webhook de Didit. Soporta el método "simple"
 * (canónico por campos, inmune a re-encoding) y el "v2" (cuerpo re-serializado
 * con claves ordenadas). Exige una ventana temporal de 300s sobre `created_at`.
 */
export function verifyDiditSignature(
  body: Json,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): boolean {
  if (!secret) return false;
  const ts = Number(body.created_at);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  const header = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const simple = header('x-signature-simple');
  if (simple) {
    const canonical = [
      String(body.created_at ?? ''),
      String(body.session_id ?? ''),
      String(body.status ?? ''),
      String(body.webhook_type ?? ''),
    ].join(':');
    if (safeEqualHex(hmacHex(secret, canonical), simple)) return true;
  }

  const v2 = header('x-signature-v2');
  if (v2) {
    const encoded = stableStringify(shortenFloats(body));
    if (safeEqualHex(hmacHex(secret, encoded), v2)) return true;
  }

  return false;
}

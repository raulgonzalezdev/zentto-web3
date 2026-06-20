/**
 * Aritmética de dinero EXACTA en base entera (escala 18), evitando floats.
 * Los importes se manejan como strings decimales en la API/BD y como BigInt
 * (unidades base 1e18) para sumar/comparar sin pérdida de precisión.
 */
const SCALE = 18;

export function toBase(amount: string | number): bigint {
  const s = (typeof amount === 'number' ? amount.toString() : amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Importe inválido: ${amount}`);
  const neg = s.startsWith('-');
  const [intPart, fracRaw = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = (fracRaw + '0'.repeat(SCALE)).slice(0, SCALE);
  const base = BigInt((intPart || '0') + frac);
  return neg ? -base : base;
}

export function fromBase(v: bigint): string {
  const neg = v < 0n;
  const a = (neg ? -v : v).toString().padStart(SCALE + 1, '0');
  const intPart = a.slice(0, a.length - SCALE);
  const frac = a.slice(a.length - SCALE).replace(/0+$/, '');
  return (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
}

export function addStr(a: string, b: string): string {
  return fromBase(toBase(a) + toBase(b));
}

export function subStr(a: string, b: string): string {
  return fromBase(toBase(a) - toBase(b));
}

/** -1 si a<b, 0 si a==b, 1 si a>b. */
export function cmpStr(a: string, b: string): number {
  const d = toBase(a) - toBase(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function isPositive(a: string): boolean {
  return toBase(a) > 0n;
}

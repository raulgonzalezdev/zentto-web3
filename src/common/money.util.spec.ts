import { addStr, cmpStr, fromBase, isPositive, subStr, toBase } from './money.util';

describe('money.util — aritmética exacta', () => {
  it('round-trip toBase/fromBase', () => {
    expect(fromBase(toBase('1.5'))).toBe('1.5');
    expect(fromBase(toBase('100'))).toBe('100');
    expect(fromBase(toBase('0'))).toBe('0');
    expect(fromBase(toBase('0.000000000000000001'))).toBe('0.000000000000000001');
  });

  it('suma sin el error clásico de float (0.1 + 0.2 = 0.3)', () => {
    expect(addStr('0.1', '0.2')).toBe('0.3');
    expect(addStr('100', '0.5')).toBe('100.5');
  });

  it('resta exacta', () => {
    expect(subStr('10', '3.5')).toBe('6.5');
    expect(subStr('1', '1')).toBe('0');
  });

  it('comparación tolerante a ceros', () => {
    expect(cmpStr('1.0', '1.00')).toBe(0);
    expect(cmpStr('2', '1.5')).toBe(1);
    expect(cmpStr('1.5', '2')).toBe(-1);
  });

  it('isPositive', () => {
    expect(isPositive('0')).toBe(false);
    expect(isPositive('0.000000000000000001')).toBe(true);
    expect(isPositive('5')).toBe(true);
  });

  it('rechaza importes inválidos', () => {
    expect(() => toBase('abc')).toThrow();
    expect(() => toBase('1,5')).toThrow();
  });
});

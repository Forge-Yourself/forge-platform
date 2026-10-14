import { describe, expect, it } from 'vitest';
import { amountInput, formatAmount, parseAmount, receiptLabel } from './receipt';

describe('receiptLabel', () => {
  it('pads to five digits under the session year', () => {
    expect(receiptLabel(418, '2026-09-09T06:00:00.000Z')).toBe('FRG-2026-00418');
    expect(receiptLabel(123456, '2026-09-09T06:00:00.000Z')).toBe('FRG-2026-123456');
  });
});

describe('amounts', () => {
  it('formats cents as dollars', () => {
    expect(formatAmount(4500)).toBe('$45.00');
    expect(formatAmount(5)).toBe('$0.05');
    expect(formatAmount(123456)).toBe('$1,234.56');
    expect(formatAmount(null)).toBeNull();
  });
  it.each([
    ['', null],
    ['  ', null],
    ['45', 4500],
    ['$45', 4500],
    ['45.5', 4550],
    ['45.50', 4550],
    ['1,200', 120000],
    ['0', 0],
  ] as const)('parses %j', (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });
  it.each(['abc', '45.555', '-5', '100001', '4 5'])('refuses %j', (text) => {
    expect(parseAmount(text)).toBe('invalid');
  });
  it('accepts the cap exactly', () => {
    expect(parseAmount('100000')).toBe(10_000_000);
  });
  it('puts an amount back in the field', () => {
    expect(amountInput(4500)).toBe('45');
    expect(amountInput(4550)).toBe('45.50');
    expect(amountInput(null)).toBe('');
  });
});

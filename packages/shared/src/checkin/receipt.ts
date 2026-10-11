/** "FRG-2026-00418" (spec D9). The year is the session's, on the device clock. */
export function receiptLabel(receiptNo: number, startsAt: string): string {
  return 'FRG-' + new Date(startsAt).getFullYear() + '-' + String(receiptNo).padStart(5, '0');
}

/** Cents → "$45.00". Null stays null so the screen can say "Not recorded". USD only (spec D8). */
export function formatAmount(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const whole = Math.floor(cents / 100);
  return '$' + whole.toLocaleString('en-US') + '.' + String(cents % 100).padStart(2, '0');
}

/** Mirrors chk_bookings_amount / chk_br_price. */
export const MAX_AMOUNT_CENTS = 10_000_000;

/**
 * What a PT typed → cents. "" → null (not recorded), "45" / "45.5" / "45.50"
 * / "$45" → cents; anything else, or over the cap, is 'invalid'.
 */
export function parseAmount(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (t === '') return null;
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return 'invalid';
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return cents > MAX_AMOUNT_CENTS ? 'invalid' : cents;
}

/** Cents → what goes back in the text field: 4500 → "45", 4550 → "45.50". */
export function amountInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

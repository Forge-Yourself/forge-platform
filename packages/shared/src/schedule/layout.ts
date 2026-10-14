export type BookingState = 'booked' | 'checked' | 'done' | 'noshow' | 'cancelled' | 'me';

/** The design's six states. The PT's own training is ME whatever its status, unless cancelled. */
export function bookingState(status: string, isSelf: boolean): BookingState {
  if (status === 'cancelled') return 'cancelled';
  if (isSelf) return 'me';
  if (status === 'no_show') return 'noshow';
  if (status === 'completed' || status === 'checked_out') return 'done';
  if (status === 'checked_in' || status === 'in_progress') return 'checked';
  return 'booked';
}

export type Span = { startMin: number; endMin: number };
export type DayRow<T> =
  | { kind: 'block'; startMin: number; endMin: number; item: T }
  | { kind: 'gap'; startMin: number; endMin: number }
  | { kind: 'now'; min: number };

const byStart = (a: Span, b: Span) => a.startMin - b.startMin;

/**
 * The Day view's rows: every booking, the open gaps left in the published
 * windows (cancelled bookings don't occupy time), and the now line. Gaps
 * already in the past are dropped; one that now cuts through starts at the
 * next quarter hour. Minutes are local minutes of the day being drawn.
 */
export function dayRows<T>(
  windows: readonly Span[],
  blocks: ReadonlyArray<Span & { item: T; occupies: boolean }>,
  nowMin: number | null,
  minGap = 30,
): DayRow<T>[] {
  const busy = blocks.filter((b) => b.occupies).sort(byStart);
  const gaps: Span[] = [];
  for (const w of [...windows].sort(byStart)) {
    let cursor = w.startMin;
    for (const b of busy) {
      if (b.endMin <= cursor || b.startMin >= w.endMin) continue;
      if (b.startMin > cursor) gaps.push({ startMin: cursor, endMin: b.startMin });
      cursor = Math.max(cursor, b.endMin);
    }
    if (cursor < w.endMin) gaps.push({ startMin: cursor, endMin: w.endMin });
  }

  const floor = nowMin === null ? null : Math.ceil(nowMin / 15) * 15;
  const open = gaps
    .map((g) => (floor === null ? g : { startMin: Math.max(g.startMin, floor), endMin: g.endMin }))
    .filter((g) => g.endMin - g.startMin >= minGap);

  const rows: Array<Extract<DayRow<T>, { kind: 'block' | 'gap' }>> = [
    ...blocks.map((b) => ({ kind: 'block' as const, startMin: b.startMin, endMin: b.endMin, item: b.item })),
    ...open.map((g) => ({ kind: 'gap' as const, startMin: g.startMin, endMin: g.endMin })),
  ].sort((a, b) => a.startMin - b.startMin || (a.kind === 'block' ? -1 : 1));

  if (nowMin === null) return rows;
  const at = rows.findIndex((r) => r.startMin > nowMin);
  const out: DayRow<T>[] = [...rows];
  out.splice(at === -1 ? out.length : at, 0, { kind: 'now', min: nowMin });
  return out;
}

/** Day numbers for a Monday-first month grid, null for padding, trimmed to whole weeks. */
export function monthCells(year: number, month0: number): (number | null)[] {
  const lead = (new Date(year, month0, 1).getDay() + 6) % 7;
  const days = new Date(year, month0 + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = i - lead + 1;
    return d >= 1 && d <= days ? d : null;
  });
}

export function slotCountsByDay(slots: ReadonlyArray<{ date: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slots) out[s.date] = (out[s.date] ?? 0) + 1;
  return out;
}

/** "6 of 8 left": every row in the series, and the scheduled ones from this session on. */
export function seriesProgress(
  rows: ReadonlyArray<{ starts_at: string; status: string }>,
  currentStartsAt: string,
): { total: number; left: number } {
  const from = Date.parse(currentStartsAt);
  return {
    total: rows.length,
    left: rows.filter((r) => r.status === 'scheduled' && Date.parse(r.starts_at) >= from).length,
  };
}

type Orderable = { id: string; exercise_id: string; is_warmup: boolean };

/**
 * Spec D10. A ULID sorts lexically by the millisecond it was minted on the
 * device, so this is client-time order however late a set reached the server.
 */
export function orderSets<T extends { id: string }>(sets: readonly T[]): T[] {
  return [...sets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What the screen prints as "Set N". set_number as stored is whatever the
 * device computed and may collide when two devices log at once; this never does.
 */
export function displayNumbers(sets: readonly Orderable[]): Record<string, number> {
  const out: Record<string, number> = {};
  const counts = new Map<string, number>();
  for (const s of orderSets(sets)) {
    if (s.is_warmup) {
      out[s.id] = 0;
      continue;
    }
    const n = (counts.get(s.exercise_id) ?? 0) + 1;
    counts.set(s.exercise_id, n);
    out[s.id] = n;
  }
  return out;
}

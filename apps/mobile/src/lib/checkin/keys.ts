import { kvStore } from '../offline/kvStore';
import { fetchCheckinKeys } from './api';

/**
 * The PT's check-in secrets, cached on the device so the code renders with no
 * signal (M5b spec D2). Stored in the KvStore 'cache' table, which is not
 * gated on the offline-logging beta: the QR screen promises "OFFLINE · CODE
 * STILL WORKS" to everyone.
 */
const keyOf = (bookingId: string) => 'checkinKey:' + bookingId;
const DAY = 86_400_000;

async function store(rows: { bookingId: string; secretHex: string }[]): Promise<void> {
  if (rows.length === 0) return;
  await kvStore.write(rows.map((r) => ({ table: 'cache' as const, key: keyOf(r.bookingId), value: r.secretHex })));
}

let lastWarm = 0;

/** Yesterday through two days out, at most once a minute. Best effort: a failure leaves the cache as it was. */
export async function warmCheckinKeys(): Promise<void> {
  const now = Date.now();
  if (now - lastWarm < 60_000) return;
  lastWarm = now;
  const r = await fetchCheckinKeys(new Date(now - DAY).toISOString(), new Date(now + 2 * DAY).toISOString());
  if (r.data) await store(r.data);
}

/**
 * Cache first; on a miss, ask the server for this booking's day (which also
 * mints the key). Null when neither has it — the screen's "Couldn't create a
 * code" state.
 */
export async function getCheckinKey(bookingId: string, startsAt: string): Promise<string | null> {
  const cached = await kvStore.get<string>('cache', keyOf(bookingId)).catch(() => null);
  if (cached) return cached;
  const start = Date.parse(startsAt);
  const r = await fetchCheckinKeys(new Date(start - 1000).toISOString(), new Date(start + 1000).toISOString());
  if (!r.data) return null;
  await store(r.data).catch(() => undefined);
  return r.data.find((k) => k.bookingId === bookingId)?.secretHex ?? null;
}

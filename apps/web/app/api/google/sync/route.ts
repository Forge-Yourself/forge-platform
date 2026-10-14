import { googleConfig } from '@/lib/google/config';
import { caller } from '@/lib/google/routeAuth';
import { googleStore } from '@/lib/google/store';
import { syncPt } from '@/lib/google/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/google/sync — the app's nudge after a booking write and when a
 * calendar screen opens (M5c spec D8). Body: `{ force? }`; `force` refreshes
 * busy times now, and only applies to a PT's own calendar.
 *
 * Syncs the caller's own connection if they have one, otherwise the
 * connected PTs they train with (a client's booking lands in their PT's
 * Google). Nothing about anyone's connection is returned to a client.
 *
 *   200 { status: 'synced' | 'revoked' | 'not_connected' | 'none', queued? }
 *   502 { status: 'unreachable' }   — Google or the network; nothing lost
 */
export async function POST(request: Request) {
  const who = await caller(request);
  if (who instanceof Response) return who;
  const config = googleConfig(request.url);
  if (!config) return Response.json({ status: 'not_configured' }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { force?: unknown } | null;
  const store = googleStore();
  const pts = await store.ptsFor(who.userId);
  if (pts.length === 0) return Response.json({ status: 'none' });

  const now = new Date();
  const deps = { store: store.sync, f: fetch, clientId: config.clientId, clientSecret: config.clientSecret, tokenKey: config.tokenKey, now };
  let own: string | null = null;
  let unreachable = false;
  for (const pt of pts) {
    const out = await syncPt(deps, pt, { forceBusy: pt === who.userId && body?.force === true });
    if (out.status === 'unreachable') {
      unreachable = true;
      console.error('google sync', out.error);
    }
    if (pt === who.userId) own = out.status;
  }

  if (own === null) return Response.json({ status: unreachable ? 'unreachable' : 'synced' }, { status: unreachable ? 502 : 200 });
  const queued = await store.queueCount(who.userId);
  return Response.json({ status: own, queued }, { status: own === 'unreachable' ? 502 : 200 });
}

import { googleConfig } from '@/lib/google/config';
import { googleStore } from '@/lib/google/store';
import { syncPt } from '@/lib/google/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/google-sync — daily (vercel.json crons). Sweeps every Google
 * connection: drains whatever the app's nudges left queued and refreshes busy
 * times that nobody's screen asked for (M5c spec D8). Sequential; one PT's
 * failure never stops the rest.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without it configured,
 * the route refuses everyone.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const config = googleConfig(request.url);
  if (!config) return Response.json({ status: 'not_configured' });

  const store = googleStore();
  const counts: Record<string, number> = {};
  for (const pt of await store.allLinkedPts()) {
    let status: string;
    try {
      const out = await syncPt(
        { store: store.sync, f: fetch, clientId: config.clientId, clientSecret: config.clientSecret, tokenKey: config.tokenKey, now: new Date() },
        pt,
      );
      status = out.status;
    } catch (e) {
      console.error('google cron', pt, e instanceof Error ? e.message : e);
      status = 'failed';
    }
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return Response.json(counts);
}

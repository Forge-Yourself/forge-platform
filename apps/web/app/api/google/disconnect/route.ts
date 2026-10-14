import { googleConfig } from '@/lib/google/config';
import { open } from '@/lib/google/seal';
import { revokeToken } from '@/lib/google/oauth';
import { caller } from '@/lib/google/routeAuth';
import { googleStore } from '@/lib/google/store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/google/disconnect — the sheet's Disconnect (M5c spec D15).
 * Deletes the connection, tokens, busy blocks, kept overlaps and queue, then
 * revokes the refresh token at Google (best effort). Events already copied
 * stay in the PT's "Forge sessions" calendar, as the sheet says.
 */
export async function POST(request: Request) {
  const who = await caller(request);
  if (who instanceof Response) return who;
  if (who.role !== 'pt') return Response.json({ error: 'not a pt' }, { status: 403 });

  const sealed = await googleStore().disconnect(who.userId);
  const config = googleConfig(request.url);
  if (sealed && config) {
    try {
      await revokeToken(fetch, open(sealed, config.tokenKey));
    } catch {
      // A token we can't open can't be used either.
    }
  }
  return Response.json({ status: 'disconnected' });
}

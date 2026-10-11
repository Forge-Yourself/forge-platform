import { googleConfig } from '@/lib/google/config';
import { consentUrl, pkcePair, randomToken } from '@/lib/google/oauth';
import { isReturnToAllowed } from '@/lib/google/returnTo';
import { caller } from '@/lib/google/routeAuth';
import { googleStore } from '@/lib/google/store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/google/connect — step one of connecting Google Calendar (M5c
 * spec D1). Body: `{ returnTo, selectAccount? }`. Stores a one-time state with
 * a PKCE verifier and answers `{ url }`, Google's consent page, which the app
 * opens in an auth session. Google then calls /api/google/callback.
 *
 *   401 no/invalid bearer · 403 not a PT · 400 returnTo not allowed
 *   503 not_configured (the GOOGLE_* env vars aren't set on this deployment)
 */
export async function POST(request: Request) {
  const who = await caller(request);
  if (who instanceof Response) return who;
  if (who.role !== 'pt') return Response.json({ error: 'not a pt' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { returnTo?: unknown; selectAccount?: unknown } | null;
  const returnTo = typeof body?.returnTo === 'string' ? body.returnTo : '';
  if (!isReturnToAllowed(returnTo)) return Response.json({ error: 'returnTo not allowed' }, { status: 400 });

  const config = googleConfig(request.url);
  if (!config) return Response.json({ error: 'not_configured' }, { status: 503 });

  const state = randomToken();
  const { verifier, challenge } = pkcePair();
  await googleStore().createState(who.userId, state, returnTo, verifier);

  return Response.json({
    url: consentUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      challenge,
      selectAccount: body?.selectAccount === true,
    }),
  });
}

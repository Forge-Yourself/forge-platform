import { calendarApi } from '@/lib/google/calendarApi';
import { googleConfig } from '@/lib/google/config';
import { emailFromIdToken, exchangeCode, hasRequiredScopes, revokeToken } from '@/lib/google/oauth';
import { caller } from '@/lib/google/routeAuth';
import { seal } from '@/lib/google/seal';
import { googleStore } from '@/lib/google/store';
import { syncPt } from '@/lib/google/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/google/finish — step three of connecting Google Calendar. Body:
 * `{ state, code }`, as the callback handed them back to the app. The code is
 * redeemed only when the caller is the PT who started the connect, so a
 * consent URL forwarded to someone else can never put their Google account
 * on the sender's Forge account.
 *
 *   200 { result: connected | nocalendars | scopes | error }
 *   400 { result: 'expired' } · 401 bearer · 403 { result: 'error' } not the state's PT
 *   503 not_configured
 */
export async function POST(request: Request) {
  const who = await caller(request);
  if (who instanceof Response) return who;
  const config = googleConfig(request.url);
  if (!config) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { state?: unknown; code?: unknown } | null;
  const state = typeof body?.state === 'string' ? body.state : '';
  const code = typeof body?.code === 'string' ? body.code : '';
  const store = googleStore();

  const peek = await store.peekState(state);
  if (!peek || !code) return Response.json({ result: 'expired' }, { status: 400 });
  // Checked before the state is used up, so a stranger can't burn the PT's attempt.
  if (peek.pt !== who.userId) return Response.json({ result: 'error' }, { status: 403 });
  const pending = await store.takeState(state);
  if (!pending || pending.pt !== who.userId) return Response.json({ result: 'expired' }, { status: 400 });

  try {
    const now = new Date();
    const tokens = await exchangeCode(
      fetch,
      { clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, code, verifier: pending.verifier },
      now,
    );
    if (!hasRequiredScopes(tokens.scopes) || !tokens.refreshToken) {
      // Unticked calendar boxes on Google's screen: nothing to sync with.
      await revokeToken(fetch, tokens.refreshToken ?? tokens.accessToken);
      return Response.json({ result: 'scopes' });
    }

    const { isNewAccount } = await store.saveConnection(pending.pt, {
      email: emailFromIdToken(tokens.idToken),
      refreshSealed: seal(tokens.refreshToken, config.tokenKey),
      accessSealed: seal(tokens.accessToken, config.tokenKey),
      expiresAt: tokens.expiresAt.toISOString(),
    });

    // The calendar list now, so the screen has it and a new account starts
    // with its main calendar ticked (spec D10).
    const calendars = await calendarApi(fetch, tokens.accessToken).listCalendars();
    const primary = calendars.filter((c) => c.primary).map((c) => c.id);
    await store.setCalendars(pending.pt, calendars, isNewAccount ? primary : null);

    await store.enqueueAll(pending.pt);
    const outcome = await syncPt(
      { store: store.sync, f: fetch, clientId: config.clientId, clientSecret: config.clientSecret, tokenKey: config.tokenKey, now },
      pending.pt,
      { forceBusy: true },
    );
    if (outcome.status === 'unreachable') console.error('google finish first sync', outcome.error);
    return Response.json({ result: calendars.length === 0 ? 'nocalendars' : 'connected' });
  } catch (e) {
    console.error('google finish', e instanceof Error ? e.message : e);
    return Response.json({ result: 'error' });
  }
}

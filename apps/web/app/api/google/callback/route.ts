import { calendarApi } from '@/lib/google/calendarApi';
import { googleConfig } from '@/lib/google/config';
import { emailFromIdToken, exchangeCode, hasRequiredScopes, revokeToken } from '@/lib/google/oauth';
import { withResult } from '@/lib/google/returnTo';
import { seal } from '@/lib/google/seal';
import { googleStore } from '@/lib/google/store';
import { syncPt } from '@/lib/google/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const back = (returnTo: string, result: string) =>
  new Response(null, { status: 302, headers: { Location: withResult(returnTo, result), 'Cache-Control': 'no-store' } });

const expired = () =>
  new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Forge</title>' +
      '<p style="font:16px system-ui;padding:24px">This link has expired. Go back to Forge and tap Connect again.</p>',
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

/**
 * GET /api/google/callback — Google sends the browser here after consent
 * (M5c spec D1, D3, D14). The state names the PT and where to send them back;
 * it is single-use. Every outcome redirects to `returnTo?gcal=<result>`:
 * connected · nocalendars · denied · scopes · error.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = googleStore();
  const pending = await store.takeState(url.searchParams.get('state') ?? '');
  if (!pending) return expired();

  if (url.searchParams.get('error')) return back(pending.returnTo, 'denied');
  const code = url.searchParams.get('code');
  const config = googleConfig(request.url);
  if (!code || !config) return back(pending.returnTo, 'error');

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
      return back(pending.returnTo, 'scopes');
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
    if (outcome.status === 'unreachable') console.error('google callback first sync', outcome.error);
    return back(pending.returnTo, calendars.length === 0 ? 'nocalendars' : 'connected');
  } catch (e) {
    console.error('google callback', e instanceof Error ? e.message : e);
    return back(pending.returnTo, 'error');
  }
}

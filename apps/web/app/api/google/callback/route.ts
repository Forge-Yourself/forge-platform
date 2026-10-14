import { withResult } from '@/lib/google/returnTo';
import { googleStore } from '@/lib/google/store';

export const dynamic = 'force-dynamic';

const back = (url: string) => new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });

const expired = () =>
  new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Forge</title>' +
      '<p style="font:16px system-ui;padding:24px">This link has expired. Go back to Forge and tap Connect again.</p>',
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

/**
 * GET /api/google/callback — Google sends the browser here after consent
 * (M5c spec D1). The callback never redeems the code itself: whoever opens a
 * consent URL is not necessarily the PT who asked for it, so a code is only
 * redeemed by POST /api/google/finish under the bearer token of the PT the
 * state names. Here the browser is just sent back to `returnTo` with
 * `gcal=finish&gcal_code&gcal_state` for the app to finish, or `gcal=denied`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const store = googleStore();
  const state = url.searchParams.get('state') ?? '';
  const pending = await store.peekState(state);
  if (!pending) return expired();

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await store.takeState(state);
    return back(withResult(pending.returnTo, url.searchParams.get('error') ? 'denied' : 'error'));
  }

  const to = new URL(withResult(pending.returnTo, 'finish'));
  to.searchParams.set('gcal_code', code);
  to.searchParams.set('gcal_state', state);
  return back(to.toString());
}

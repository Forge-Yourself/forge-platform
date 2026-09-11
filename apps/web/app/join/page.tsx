import * as ui from '@/lib/ui/styles';

export const dynamic = 'force-dynamic';

/**
 * Public invite-link landing page — no auth, reachable by anyone with the
 * link (the PT's "Copy link" / "Share invite" actions build exactly this
 * URL, apps/mobile Task 9). Redirects into the app via a meta-refresh to
 * `forge://join?type=join&email=…` (lib/deepLinks.ts's `type=join` branch),
 * with a static fallback for the case the app isn't installed — there is no
 * store listing until M10, so the fallback names Expo Go / TestFlight
 * explicitly rather than linking to app stores that don't exist yet.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const deepLink = email ? `forge://join?type=join&email=${encodeURIComponent(email)}` : null;

  return (
    <main style={ui.page}>
      {deepLink ? <meta httpEquiv="refresh" content={`0;url=${deepLink}`} /> : null}

      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>You&apos;ve been invited</h1>

      {email ? (
        <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: '60ch' }}>
          Opening the Forge app for <strong>{email}</strong>…
        </p>
      ) : (
        <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: '60ch' }}>
          This link is missing an invited address — ask your trainer to resend it.
        </p>
      )}

      <p style={{ color: 'var(--text-muted)', margin: 0, maxWidth: '60ch' }}>
        Don&apos;t have the app yet? Forge isn&apos;t on the app stores yet — your trainer can
        send you an Expo Go link or a TestFlight invite instead.
      </p>

      {deepLink ? (
        <p style={ui.muted}>
          Nothing happened?{' '}
          <a href={deepLink} style={ui.link}>
            Tap here to open Forge
          </a>
          .
        </p>
      ) : null}
    </main>
  );
}

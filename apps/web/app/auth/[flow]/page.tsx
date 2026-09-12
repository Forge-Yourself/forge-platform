import { notFound } from 'next/navigation';
import * as ui from '@/lib/ui/styles';

export const dynamic = 'force-dynamic';

/**
 * The https bounce page for Supabase's auth emails.
 *
 * Both templates used to link straight to `forge://auth/confirm?...`. That works when
 * a link is tapped from somewhere that will hand a custom scheme to the OS — but mail
 * clients largely will not. Gmail on Android, the likeliest client for a Lebanon-first
 * launch, strips or refuses to linkify a non-http(s) href, and the plain-text fallback
 * is no better: a browser address bar will not open `forge://` either. The result was
 * a confirmation email that could not be acted on at all.
 *
 * So the emails now point at an https URL on this domain, and this page forwards to
 * the deep link the same way `/join` already does. Two hops, but both hops are ones
 * every mail client and browser will actually take.
 *
 * SECURITY: `flow` is matched against a fixed map, never interpolated into the target,
 * and only `token_hash` is forwarded. There is deliberately no `redirect_to`-style
 * parameter — a page that forwards to a caller-supplied URL is an open redirect, and
 * an auth email is exactly where that gets abused. An unknown flow 404s.
 */
const FLOWS = {
  confirm: { otpType: 'signup', heading: 'Confirm your email', action: 'Confirm email' },
  reset: { otpType: 'recovery', heading: 'Reset your password', action: 'Reset password' },
} as const;

type Flow = keyof typeof FLOWS;

function isFlow(value: string): value is Flow {
  return Object.prototype.hasOwnProperty.call(FLOWS, value);
}

export default async function AuthBouncePage({
  params,
  searchParams,
}: {
  params: Promise<{ flow: string }>;
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const { flow } = await params;
  if (!isFlow(flow)) {
    notFound();
  }

  const { token_hash: tokenHash } = await searchParams;
  const config = FLOWS[flow];
  const deepLink = tokenHash
    ? `forge://auth/${flow}?token_hash=${encodeURIComponent(tokenHash)}&type=${config.otpType}`
    : null;

  return (
    <main style={ui.page}>
      {deepLink ? <meta httpEquiv="refresh" content={`0;url=${deepLink}`} /> : null}

      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>{config.heading}</h1>

      {deepLink ? (
        <>
          <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: '60ch' }}>
            Opening the Forge app…
          </p>
          <p style={ui.muted}>
            Nothing happened?{' '}
            <a href={deepLink} style={ui.link}>
              Tap here to {config.action.toLowerCase()}
            </a>
            .
          </p>
        </>
      ) : (
        <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: '60ch' }}>
          This link is missing its token, which usually means it was copied incompletely.
          Request a new email from the app and use the most recent one.
        </p>
      )}

      <p style={{ color: 'var(--text-muted)', margin: 0, maxWidth: '60ch' }}>
        Links expire 30 minutes after they are sent and work only once.
      </p>
    </main>
  );
}

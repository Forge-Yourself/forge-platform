import { createHash, randomBytes } from 'node:crypto';
import { GoogleAuthRevoked, GoogleHttpError } from './errors';

/** M5c spec D3. Forge only ever writes to the calendar it creates. */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
] as const;

/** The calendar scopes sync can't work without. Google's consent screen lets a user untick them. */
export const REQUIRED_SCOPES = GOOGLE_SCOPES.slice(2);

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

type Fetch = typeof fetch;

export type TokenSet = {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string | null;
  idToken: string | null;
  scopes: string[];
};

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function consentUrl(a: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  selectAccount?: boolean;
}): string {
  const q = new URLSearchParams({
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    // consent every time, so Google always returns a refresh token (it only
    // does on a fresh consent) — a reconnect must replace the revoked one.
    prompt: a.selectAccount ? 'consent select_account' : 'consent',
    include_granted_scopes: 'true',
    state: a.state,
    code_challenge: a.challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${q.toString()}`;
}

async function tokenCall(f: Fetch, form: Record<string, string>, now: Date): Promise<TokenSet> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let code = '';
    try {
      code = (JSON.parse(text) as { error?: string }).error ?? '';
    } catch {
      // not JSON
    }
    if (code === 'invalid_grant') throw new GoogleAuthRevoked();
    throw new GoogleHttpError(res.status, text);
  }
  const body = JSON.parse(text) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    id_token?: string;
    scope?: string;
  };
  return {
    accessToken: body.access_token,
    expiresAt: new Date(now.getTime() + body.expires_in * 1000),
    refreshToken: body.refresh_token ?? null,
    idToken: body.id_token ?? null,
    scopes: (body.scope ?? '').split(' ').filter(Boolean),
  };
}

export function exchangeCode(
  f: Fetch,
  a: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string },
  now: Date,
): Promise<TokenSet> {
  return tokenCall(
    f,
    {
      grant_type: 'authorization_code',
      code: a.code,
      client_id: a.clientId,
      client_secret: a.clientSecret,
      redirect_uri: a.redirectUri,
      code_verifier: a.verifier,
    },
    now,
  );
}

export function refreshAccess(
  f: Fetch,
  a: { clientId: string; clientSecret: string; refreshToken: string },
  now: Date,
): Promise<TokenSet> {
  return tokenCall(
    f,
    { grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: a.clientId, client_secret: a.clientSecret },
    now,
  );
}

/** Best effort: a token Google already dropped answers 400, which is the same outcome. */
export async function revokeToken(f: Fetch, token: string): Promise<void> {
  try {
    await f(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // The connection is deleted on our side regardless.
  }
}

/**
 * The id token arrives straight from Google's token endpoint over TLS, so
 * its payload is trusted without verifying the signature (OIDC Core §3.1.3.7).
 */
export function emailFromIdToken(idToken: string | null): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

export function hasRequiredScopes(scopes: string[]): boolean {
  return REQUIRED_SCOPES.every((s) => scopes.includes(s));
}

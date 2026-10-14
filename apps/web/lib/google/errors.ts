/**
 * Google answered in a way that means the PT has to connect again: the
 * refresh token is revoked or expired (`invalid_grant`), or an API call was
 * refused as unauthenticated. Sync stops and the link flips to `error`
 * (M5c spec D13).
 */
export class GoogleAuthRevoked extends Error {
  constructor(message = 'google_auth_revoked') {
    super(message);
    this.name = 'GoogleAuthRevoked';
  }
}

/**
 * Any other non-2xx from Google. 5xx and 429 are transient, and so is a 403
 * whose reason is a rate limit or quota (Calendar answers usage limits with
 * 403, not 429); the rest are about one request.
 */
export class GoogleHttpError extends Error {
  readonly status: number;
  private readonly rateLimited: boolean;

  constructor(status: number, body: string) {
    super(`google_http_${status}: ${body.slice(0, 200)}`);
    this.name = 'GoogleHttpError';
    this.status = status;
    this.rateLimited = status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(body);
  }

  get transient(): boolean {
    return this.status >= 500 || this.status === 429 || this.rateLimited;
  }
}

/** True for failures that say nothing about a single booking: the network, Google's 5xx, rate limits. */
export function isTransient(e: unknown): boolean {
  if (e instanceof GoogleHttpError) return e.transient;
  return !(e instanceof GoogleAuthRevoked);
}

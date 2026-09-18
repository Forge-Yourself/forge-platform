import type { PostgrestError } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';

/**
 * Maps a log_set / complete_workout_session failure to copy that names the
 * cause, in the shape authErrors.ts established: switch on a stable code,
 * default to generic, never invent a reason. Postgres SQLSTATEs: 42501 is a
 * policy/privilege denial, 23514 is the RPC's own USING ERRCODE for a rule
 * the client should have caught, P0001 is a bare RAISE EXCEPTION whose text
 * is the only signal. A fetch that never reached Postgres arrives with an
 * empty code and the TypeError text in message.
 */
export function mapLoggingError(error: PostgrestError | Error | null | undefined, t: TFunction): string {
  if (!error) return t('logging.session.errorGeneric');
  const code = 'code' in error && typeof error.code === 'string' ? error.code : null;
  const message = error.message ?? '';

  // postgrest-js reports a fetch that never reached the server as code '' with
  // the TypeError text in message ("Failed to fetch" on web, "Network request
  // failed" on native). An AbortError (timeout) also has code '' but is not
  // offline — it falls through to generic on purpose. Anything without a
  // recognised code (a 502 HTML page, a wrapper Error) is a server fault, not
  // an offline device, and must never read as "offline": M4b routes offline
  // failures into the outbox.
  if (code === '' && /network|failed to fetch/i.test(message)) {
    return t('logging.session.errorOffline');
  }
  if (code === '42501' || /not authorized/i.test(message)) {
    return t('logging.session.errorDenied');
  }
  if (/not in progress|already finished/i.test(message)) {
    return t('logging.session.errorClosed');
  }
  return t('logging.session.errorGeneric');
}

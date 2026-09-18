import type { PostgrestError } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';

/**
 * Maps a log_set / complete_workout_session failure to copy that names the
 * cause, in the shape authErrors.ts established: switch on a stable code,
 * default to generic, never invent a reason. Postgres SQLSTATEs: 42501 is a
 * policy/privilege denial, 23514 is the RPC's own USING ERRCODE for a rule
 * the client should have caught, P0001 is a bare RAISE EXCEPTION whose text
 * is the only signal. A fetch that never reached Postgres has no code at all.
 */
export function mapLoggingError(error: PostgrestError | Error | null | undefined, t: TFunction): string {
  if (!error) return t('logging.session.errorGeneric');
  const code = 'code' in error ? error.code : undefined;
  const message = error.message ?? '';

  if (code === undefined || /network|fetch|failed to fetch/i.test(message)) {
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

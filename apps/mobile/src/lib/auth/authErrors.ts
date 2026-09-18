import type { AuthError } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';

/** Matches Supabase's `otp_expiry = 1800` (Task 2 config) — 30 minutes. */
export const OTP_EXPIRY_MINUTES = 30;

/**
 * Maps a Supabase Auth error to a translated, human-readable string.
 *
 * `invalid_credentials` (wrong password OR no such account) deliberately maps to the
 * SAME copy in every locale, regardless of which of the two actually happened — never
 * branch UI copy on whether an account exists, or the screen becomes an account
 * enumeration oracle (OWASP ASVS 2.1). The same rule applies to forgot-password: it DOES
 * call this mapper, but only for a rate-limit error (which isn't account-specific), and
 * its success/failure confirmation copy never branches on `error` at all — see
 * apps/mobile/src/app/(auth)/forgot-password.tsx.
 */
/**
 * GoTrue reports a failed outbound email as a bare 500 `unexpected_failure`, with the
 * only real detail in the human-readable message ("Error sending confirmation email").
 * There is no dedicated error_code for it, so the message is the sole signal — hence
 * the regex rather than another `case`. Kept deliberately loose (confirmation /
 * recovery / magic-link all phrase it slightly differently) and fail-soft: anything it
 * doesn't match still lands on the generic copy, it never invents a wrong cause.
 *
 * Worth mapping because the un-mapped version cost real debugging time: an unverified
 * Resend sender domain made every signup fail, and the screen said only "Something went
 * wrong. Please try again." — advice that could not work, for a fault no retry fixes.
 */
const MAIL_DELIVERY_MESSAGE = /error sending .*(email|mail)/i;

export function mapAuthError(error: AuthError | null | undefined, t: TFunction): string {
  if (!error) {
    return t('auth.errors.generic');
  }

  if (error.code === 'unexpected_failure' && MAIL_DELIVERY_MESSAGE.test(error.message)) {
    return t('auth.errors.mailDelivery');
  }

  switch (error.code) {
    case 'invalid_credentials':
      return t('auth.errors.invalidCredentials');
    case 'email_not_confirmed':
      return t('auth.errors.emailNotConfirmed');
    case 'user_already_exists':
    case 'email_exists':
      return t('auth.errors.userAlreadyExists');
    case 'weak_password':
      return t('auth.errors.weakPassword');
    case 'same_password':
      return t('auth.errors.samePassword');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return t('auth.errors.rateLimited');
    case 'session_expired':
    case 'session_not_found':
      return t('auth.errors.sessionExpired');
    case 'network_error':
      return t('auth.errors.network');
    default:
      return t('auth.errors.generic');
  }
}

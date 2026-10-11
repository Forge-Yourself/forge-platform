/** The tokens 0021's RPCs raise, one-to-one with copy. Same shape as schedule/errors.ts. */
export const CHECKIN_ERROR_CODES = [
  'wrong_booking',
  'code_expired',
  'bad_code',
  'no_booking_now',
  'outside_check_in',
  'not_checked_in',
  'not_ratable',
  'bad_rating',
  'bad_amount',
  'booking_closed',
  'not_authorized',
] as const;

export type CheckinErrorCode = (typeof CHECKIN_ERROR_CODES)[number] | 'offline' | 'unknown';

const KEYS: Record<CheckinErrorCode, string> = {
  wrong_booking: 'checkin.errors.wrongBooking',
  code_expired: 'checkin.errors.codeExpired',
  bad_code: 'checkin.errors.badCode',
  no_booking_now: 'checkin.errors.noBookingNow',
  outside_check_in: 'checkin.errors.outsideCheckIn',
  not_checked_in: 'checkin.errors.notCheckedIn',
  not_ratable: 'checkin.errors.notRatable',
  bad_rating: 'checkin.errors.unknown',
  bad_amount: 'checkin.errors.badAmount',
  booking_closed: 'checkin.errors.bookingClosed',
  not_authorized: 'checkin.errors.notAuthorized',
  offline: 'checkin.errors.offline',
  unknown: 'checkin.errors.unknown',
};

const OFFLINE = /failed to fetch|network request failed|load failed|networkerror/i;

export function checkinErrorCode(message?: string | null): CheckinErrorCode {
  if (!message) return 'unknown';
  if (message === 'not authorized') return 'not_authorized';
  if (OFFLINE.test(message)) return 'offline';
  return (CHECKIN_ERROR_CODES as readonly string[]).includes(message) ? (message as CheckinErrorCode) : 'unknown';
}

export function checkinErrorKey(code: CheckinErrorCode): string {
  return KEYS[code];
}

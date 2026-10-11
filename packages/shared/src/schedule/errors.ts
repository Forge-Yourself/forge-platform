/**
 * The tokens 0020's RPCs raise, one-to-one with screen copy. The RPCs raise
 * the bare token as the message, so PostgREST hands it back verbatim in
 * `error.message`. 'not authorized' is 0015's wording, kept for consistency.
 */
export const BOOKING_ERROR_CODES = [
  'slot_taken',
  'outside_hours',
  'outside_window',
  'inside_cutoff',
  'in_past',
  'length_not_offered',
  'too_early_for_no_show',
  'series_too_long',
  'booking_closed',
  'session_started',
  'overlapping_hours',
  'bad_range',
  'client_not_bookable',
  'bad_repeat',
  'range_too_long',
  'not_authorized',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number] | 'offline' | 'unknown';

const KEYS: Record<BookingErrorCode, string> = {
  slot_taken: 'schedule.errors.slotTaken',
  outside_hours: 'schedule.errors.outsideHours',
  outside_window: 'schedule.errors.outsideWindow',
  inside_cutoff: 'schedule.errors.insideCutoff',
  in_past: 'schedule.errors.inPast',
  length_not_offered: 'schedule.errors.lengthNotOffered',
  too_early_for_no_show: 'schedule.errors.tooEarlyForNoShow',
  series_too_long: 'schedule.errors.seriesTooLong',
  booking_closed: 'schedule.errors.bookingClosed',
  session_started: 'schedule.errors.sessionStarted',
  overlapping_hours: 'schedule.errors.overlappingHours',
  bad_range: 'schedule.errors.badRange',
  client_not_bookable: 'schedule.errors.clientNotBookable',
  bad_repeat: 'schedule.errors.badRepeat',
  range_too_long: 'schedule.errors.unknown',
  not_authorized: 'schedule.errors.notAuthorized',
  offline: 'schedule.errors.offline',
  unknown: 'schedule.errors.unknown',
};

const OFFLINE = /failed to fetch|network request failed|load failed|networkerror/i;

export function bookingErrorCode(message?: string | null): BookingErrorCode {
  if (!message) return 'unknown';
  if (message === 'not authorized') return 'not_authorized';
  if (OFFLINE.test(message)) return 'offline';
  return (BOOKING_ERROR_CODES as readonly string[]).includes(message) ? (message as BookingErrorCode) : 'unknown';
}

export function bookingErrorKey(code: BookingErrorCode): string {
  return KEYS[code];
}

/**
 * What Forge writes to Google and what it reads back (M5c spec D5, D6, D9).
 */

export type QueuedBooking = {
  bookingId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  title: string;
  attempts: number;
  queuedAt: string;
};

/** Google event ids are base32hex ([a-v0-9]); a UUID's hex digits already are. */
export function eventIdFor(bookingId: string): string {
  return 'forge' + bookingId.replace(/-/g, '').toLowerCase();
}

/** Cancelled bookings are removed from Google; every other status stays as a record. */
export function belongsInGoogle(status: string): boolean {
  return status !== 'cancelled';
}

export function eventBodyFor(b: QueuedBooking) {
  return {
    id: eventIdFor(b.bookingId),
    summary: b.title,
    status: 'confirmed',
    transparency: 'opaque',
    start: { dateTime: new Date(b.startsAt).toISOString(), timeZone: b.timezone },
    end: { dateTime: new Date(b.endsAt).toISOString(), timeZone: b.timezone },
    extendedProperties: { private: { forgeBookingId: b.bookingId } },
  };
}

export type BusyInput = {
  calendar_id: string;
  event_id: string;
  title: string | null;
  start?: string;
  end?: string;
  start_date?: string;
  end_date?: string;
};

export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
};

/**
 * The events that make the PT busy: not cancelled, not marked "free", not
 * declined, and not one of Forge's own copies. All-day events keep their
 * dates; SQL turns them into local midnights in the PT's zone.
 */
export function busyFromEvents(calendarId: string, items: GoogleEvent[]): BusyInput[] {
  const out: BusyInput[] = [];
  for (const e of items) {
    if (!e.id || e.status === 'cancelled' || e.transparency === 'transparent') continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
    if (e.extendedProperties?.private?.forgeBookingId) continue;
    const title = e.summary?.trim() || null;
    if (e.start?.dateTime && e.end?.dateTime) {
      out.push({ calendar_id: calendarId, event_id: e.id, title, start: e.start.dateTime, end: e.end.dateTime });
    } else if (e.start?.date && e.end?.date) {
      out.push({ calendar_id: calendarId, event_id: e.id, title, start_date: e.start.date, end_date: e.end.date });
    }
  }
  return out;
}

/**
 * RFC 5545 calendar text for the PT's export and the client's "Add to my
 * calendar" (M5c spec D16). Times are written in UTC so no VTIMEZONE block is
 * needed and every calendar app shows the same instant the booking holds.
 */

export type IcsEvent = {
  /** The booking id. Becomes `<uid>@forge.app`, so a re-import updates instead of duplicating. */
  uid: string;
  title: string;
  /** ISO instants. */
  start: string;
  end: string;
  /** Bumped when the booking changes (seconds of updated_at); importers keep the highest. */
  sequence?: number;
};

const CRLF = '\r\n';

/** Any ISO instant → `YYYYMMDDTHHMMSSZ`. */
export function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * Folds a content line at 75 octets (§3.1): continuation lines start with one
 * space, which counts toward their 75. Splits between code points, never
 * inside a multi-byte character.
 */
export function foldLine(line: string): string {
  if (utf8Length(line) <= 75) return line;
  const out: string[] = [];
  let current = '';
  let limit = 75;
  for (const ch of line) {
    if (utf8Length(current + ch) > limit) {
      out.push(current);
      current = ' ';
      limit = 75;
    }
    current += ch;
  }
  out.push(current);
  return out.join(CRLF);
}

export function buildIcs(events: IcsEvent[], now: Date): string {
  const stamp = icsDate(now.toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Forge//Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@forge.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `SEQUENCE:${e.sequence ?? 0}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

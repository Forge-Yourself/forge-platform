import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, icsDate } from './ics';

const NOW = new Date('2026-10-11T09:40:00Z');
const ev = {
  uid: '5c000000-0000-4000-8000-0000000000a2',
  title: 'Forge · Karim',
  start: '2026-10-13T14:00:00.000Z',
  end: '2026-10-13T15:00:00+00:00',
  sequence: 3,
};

describe('icsDate', () => {
  it('formats any ISO instant as UTC basic format', () => {
    expect(icsDate('2026-10-13T17:00:00+03:00')).toBe('20261013T140000Z');
  });
});

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:x')).toBe('SUMMARY:x');
  });

  it('folds at 75 octets with a leading space on each continuation', () => {
    const line = 'SUMMARY:' + 'a'.repeat(120);
    const parts = foldLine(line).split('\r\n');
    expect(parts.length).toBe(2);
    expect(Buffer.byteLength(parts[0]!)).toBe(75);
    expect(parts[1]!.startsWith(' ')).toBe(true);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = 'SUMMARY:' + 'جلسة '.repeat(40);
    const parts = foldLine(line).split('\r\n');
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
    expect(parts.join('')).not.toContain('�');
  });
});

describe('buildIcs', () => {
  it('writes a calendar with CRLF line ends only', () => {
    const out = buildIcs([ev], NOW);
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('writes one VEVENT with UID, stamp, times, summary and sequence', () => {
    const lines = buildIcs([ev], NOW).split('\r\n');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('UID:5c000000-0000-4000-8000-0000000000a2@forge.app');
    expect(lines).toContain('DTSTAMP:20261011T094000Z');
    expect(lines).toContain('DTSTART:20261013T140000Z');
    expect(lines).toContain('DTEND:20261013T150000Z');
    expect(lines).toContain('SUMMARY:Forge · Karim');
    expect(lines).toContain('SEQUENCE:3');
    expect(lines).toContain('PRODID:-//Forge//Schedule//EN');
    expect(lines).toContain('VERSION:2.0');
  });

  it('escapes the title', () => {
    expect(buildIcs([{ ...ev, title: 'A, B; C' }], NOW)).toContain('SUMMARY:A\\, B\\; C');
  });

  it('is still a valid calendar with no events', () => {
    const out = buildIcs([], NOW);
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).not.toContain('BEGIN:VEVENT');
  });

  it('defaults the sequence to 0', () => {
    expect(buildIcs([{ ...ev, sequence: undefined }], NOW)).toContain('SEQUENCE:0');
  });
});

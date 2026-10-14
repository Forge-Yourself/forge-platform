import { describe, expect, it } from 'vitest';
import { eventTitle } from './title';

// The same rule is in SQL (google_queue_batch, 0022); db/rls_assertions.sql pins it there.
describe('eventTitle', () => {
  it('uses the first name only', () => {
    expect(eventTitle('Rami Nassif', false)).toBe('Forge · Rami');
  });
  it('trims and splits on the first space', () => {
    expect(eventTitle('  Karim   Aoun ', false)).toBe('Forge · Karim');
  });
  it('calls the PT\'s own training Me', () => {
    expect(eventTitle('Joseph Haddad', true)).toBe('Forge · Me');
  });
  it('falls back when there is no name', () => {
    expect(eventTitle('', false)).toBe('Forge · Session');
    expect(eventTitle(null, false)).toBe('Forge · Session');
  });
});

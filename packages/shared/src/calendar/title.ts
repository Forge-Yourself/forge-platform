/**
 * "Forge · <first name>" — what a booking is called outside Forge (M5c spec
 * D6): Google events and exported .ics files carry a first name and nothing
 * else. The same rule is in SQL (google_queue_batch, 0022) for the server's
 * Google writes; both sides are tested.
 */
export function eventTitle(displayName: string | null | undefined, isSelf: boolean): string {
  if (isSelf) return 'Forge · Me';
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return 'Forge · ' + (first ? first : 'Session');
}

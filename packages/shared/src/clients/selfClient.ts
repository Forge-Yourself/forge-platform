/** The two columns that decide whether a `clients` row is a PT's own record. */
export type SelfClientShape = {
  pt_user_id: string;
  client_user_id: string | null;
};

/**
 * A self client row: the PT and the subject are the same user.
 *
 * `uq_clients_self` (migration 0019) makes at most one of these exist per PT,
 * and `ensure_self_client()` is the only thing that can create one. Every
 * write predicate in the schema is `is_pt_of_client(...) OR
 * is_client_record_owner(...)`, so such a row satisfies both — which is why a
 * PT can log, measure and photograph themselves with no new policy.
 *
 * An unclaimed invite (`client_user_id IS NULL`) is never a self row, however
 * the invite was addressed.
 */
export function isSelfClientRow(row: SelfClientShape): boolean {
  return row.client_user_id !== null && row.client_user_id === row.pt_user_id;
}

/**
 * Splits a PT's `clients` rows into the people they are responsible for and
 * their own record.
 *
 * This exists as one function, tested once, because the same mistake is easy
 * to make in several screens and only one of them fails loudly. Counting the
 * self row as a client makes the Today screen's "Awaiting intake" tile read 1
 * forever — the self record has no intake by design and therefore can never
 * sign a waiver — and puts a "Needs you" row titled with the PT's own name in
 * front of them. It also suppresses the "Invite your first client" empty
 * state for a PT whose only "client" is themselves.
 *
 * Callers that genuinely want to act on the record (the assign picker, the AI
 * draft picker) take `self` and put it back deliberately.
 */
export function splitRoster<T extends SelfClientShape>(rows: readonly T[]): { roster: T[]; self: T | null } {
  const roster: T[] = [];
  let self: T | null = null;
  for (const row of rows) {
    if (self === null && isSelfClientRow(row)) self = row;
    else roster.push(row);
  }
  return { roster, self };
}

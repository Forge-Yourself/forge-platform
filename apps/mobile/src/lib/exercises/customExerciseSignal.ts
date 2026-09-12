/**
 * A one-shot "the library is stale" flag, set by (app)/library/custom.tsx after a
 * successful insert and consumed by the library tab when it next gains focus.
 *
 * The custom-exercise screen finishes with router.back(), which returns to a TAB
 * screen — and a tab screen stays mounted, so useExerciseSearch's effect never
 * re-runs and the exercise the PT just created is missing from the list until they
 * happen to change the search text. A plain refetch-on-every-focus would work, but
 * the library tab is focused constantly (it is one tap away from everything) and
 * every one of those would reset pagination back to page 0, silently throwing away a
 * "load more" the PT had already done.
 *
 * So the write tells the reader, rather than the reader polling. Same shape and same
 * reasoning as lib/programs/exercisePicker.ts, which hands a chosen exercise back to
 * the builder across the identical navigation boundary.
 *
 * take() clears as it reads, so one insert causes exactly one refetch.
 */
let pending = false;

export function markCustomExerciseCreated(): void {
  pending = true;
}

export function takeCustomExerciseCreated(): boolean {
  const wasPending = pending;
  pending = false;
  return wasPending;
}

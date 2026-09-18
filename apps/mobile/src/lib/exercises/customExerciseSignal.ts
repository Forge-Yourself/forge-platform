/**
 * A monotonic "the library changed" counter, bumped by (app)/library/custom.tsx
 * after a successful insert and observed by every mounted ExerciseLibrary.
 *
 * The custom-exercise screen finishes with router.back(), which returns to a
 * screen that never unmounted — so useExerciseSearch's effect does not re-run and
 * the exercise the PT just created is missing from the list until they happen to
 * change the search text. A plain refetch-on-every-focus would work, but the
 * library is focused constantly (it is one tap away from everything) and every
 * one of those would reset pagination back to page 0, silently throwing away a
 * "load more" the PT had already done.
 *
 * WHY A COUNTER AND NOT A ONE-SHOT FLAG. This was a boolean that cleared as it
 * was read, which was correct while the library had exactly one mount point. It
 * now has two — the Library tab and the builder's programs/[id]/pick-exercise —
 * and a tab screen stays mounted underneath a pushed one, so both exist at once
 * while only the focused one runs its effect. Whichever regained focus first
 * consumed the flag and the other never learned anything had changed: create a
 * custom exercise from inside the builder, then open the Library tab, and it is
 * not there. A counter cannot be consumed — each mount compares it against the
 * last value it acted on, so every one of them refetches exactly once.
 *
 * Same shape and same reasoning as lib/programs/exercisePicker.ts, which hands a
 * chosen exercise back to the builder across the identical navigation boundary —
 * that one is still correctly a one-shot, because a handoff has exactly one
 * intended recipient where this notification has every mounted list.
 */
let generation = 0;

export function markCustomExerciseCreated(): void {
  generation += 1;
}

/** The current value. Observers store it and compare; they never clear it. */
export function customExerciseGeneration(): number {
  return generation;
}

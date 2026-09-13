/**
 * A one-slot handoff between the exercise library and the program builder.
 *
 * The builder pushes programs/[id]/pick-exercise; a row there opens the library's
 * detail screen carrying the programId; "Add to program" drops the chosen exercise
 * here and dismisses back to the builder, which consumes it on focus. A module
 * singleton rather than route params because the alternative — popping and then
 * router.setParams() — races the focus change, and because the builder's unsaved
 * local draft must survive the round trip, which a remount from a params change
 * would not guarantee.
 *
 * take() clears as it reads, so a stale pick can never be applied twice.
 */
export type PickedExercise = { id: string; name: string };

let pending: PickedExercise | null = null;

export function setPickedExercise(exercise: PickedExercise): void {
  pending = exercise;
}

export function takePickedExercise(): PickedExercise | null {
  const picked = pending;
  pending = null;
  return picked;
}

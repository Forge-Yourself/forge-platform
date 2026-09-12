/**
 * Turns a failed zod `safeParse().error.issues` array into a `Partial<Record<F, string>>`
 * map of the first error message per field, keyed by each issue's top-level path segment.
 *
 * Pass `keyMap` when the zod schema's field name differs from the UI field name (e.g.
 * `displayName` -> `fullName`), or to explicitly allow/rename which raw keys map to which
 * UI fields. Return `null` from `keyMap` to drop an issue instead of mapping it.
 */
export function zodIssuesToFieldErrors<F extends string>(
  issues: readonly { path: PropertyKey[]; message: string }[],
  keyMap?: (rawKey: PropertyKey) => F | null,
): Partial<Record<F, string>> {
  const errors: Partial<Record<F, string>> = {};
  for (const issue of issues) {
    const rawKey = issue.path[0];
    const field = keyMap ? keyMap(rawKey) : (rawKey as F);
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

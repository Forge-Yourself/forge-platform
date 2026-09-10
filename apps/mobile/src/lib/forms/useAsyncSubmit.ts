import { useCallback, useState } from 'react';

/**
 * Removes the repeated `useState(false)` submitting flag + `setSubmitting(true)` /
 * `setSubmitting(false)` bracketing duplicated across the auth screens' submit handlers.
 *
 * Screens here handle Supabase's `{ data, error }` return shape manually rather than
 * throwing, so `run` doesn't impose a throw-based error API — it only brackets
 * `submitting` around `fn` (via try/finally, so `submitting` still clears if `fn` does
 * throw) and exposes `error`/`setError` as a plain slot for whatever a screen wants to
 * put in it (e.g. via `mapAuthError`).
 */
export function useAsyncSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setSubmitting(true);
    try {
      await fn();
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submitting, error, setError, run };
}

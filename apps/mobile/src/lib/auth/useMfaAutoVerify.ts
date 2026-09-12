import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { mapAuthError } from './authErrors';
import { supabase } from '../supabase';
import { useAsyncSubmit } from '../forms/useAsyncSubmit';

/**
 * Shared by (onboarding)/mfa-enroll.tsx and (auth)/mfa-challenge.tsx — both screens
 * verify a 6-digit TOTP code the instant it's fully entered (no submit button), reset
 * on failure, and were previously hand-rolling the identical effect. The one real
 * difference between the two screens — what happens AFTER a successful verify
 * (log + navigate for enrollment, nothing for a routine challenge) — stays with the
 * caller via `onVerified`, since that part genuinely isn't shared.
 */
export function useMfaAutoVerify(
  factorId: string | null,
  challengeId: string | null,
  t: TFunction,
  onVerified: () => void,
) {
  const [code, setCode] = useState('');
  const { submitting, error, setError, run } = useAsyncSubmit();

  /**
   * A one-way latch, because `submitting` is in this effect's dependency list and
   * the code is still six digits long after a SUCCESSFUL verify. The sequence
   * without it: the 6th digit lands, the effect runs, `run` flips `submitting`
   * true (effect re-runs, guard stops it), verify succeeds, `run`'s finally flips
   * `submitting` back to false — and the effect runs a THIRD time against an
   * unchanged six-digit code, calling mfa.verify() again on a challenge the
   * server has already consumed. The user sees a red "invalid code" banner
   * immediately after a correct one.
   *
   * It bites hardest on (auth)/mfa-challenge, whose onVerified is a no-op by
   * design: the screen stays mounted while the root gate re-checks AAL
   * asynchronously, so the second call always lands. Set before onVerified()
   * runs, which is before `submitting` can flip and re-trigger the effect.
   */
  const verifiedRef = useRef(false);

  useEffect(() => {
    if (verifiedRef.current) {
      return;
    }
    if (code.length !== 6 || !factorId || !challengeId || submitting) {
      return;
    }
    void run(async () => {
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (verifyError) {
        setError(mapAuthError(verifyError, t));
        setCode('');
        return;
      }
      verifiedRef.current = true;
      onVerified();
    });
    // Re-running this effect when onVerified's identity changes is harmless — the
    // early-return guards above mean it's a no-op on every render except the one
    // where the 6th digit just landed, so onVerified is included rather than omitted.
  }, [code, factorId, challengeId, submitting, run, setError, t, onVerified]);

  return { code, setCode, verifyError: error, submitting };
}

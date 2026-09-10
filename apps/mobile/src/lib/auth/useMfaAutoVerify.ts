import { useEffect, useState } from 'react';
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

  useEffect(() => {
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
      onVerified();
    });
    // Re-running this effect when onVerified's identity changes is harmless — the
    // early-return guard above means it's a no-op on every render except the one
    // where the 6th digit just landed, so onVerified is included rather than omitted.
  }, [code, factorId, challengeId, submitting, run, setError, t, onVerified]);

  return { code, setCode, verifyError: error, submitting };
}

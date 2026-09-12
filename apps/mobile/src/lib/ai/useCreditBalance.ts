import { creditState, type CreditState } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

async function fetchBalance(
  userId: string,
): Promise<{ balance: number | null; error: string | null }> {
  // A plain RLS-scoped select, not an RPC: ai_credit_wallets_select already
  // scopes this to the caller's own wallet, and a read needs no elevation.
  const { data, error } = await supabase
    .from('ai_credit_wallets')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return { balance: null, error: error.message };
  return { balance: data?.balance ?? null, error: null };
}

/**
 * `'loading'` is not part of the shared CreditState machine (D36 has three states,
 * and tokens/tests pin them) — it is this hook's own fourth value, for the window
 * before the first fetch settles.
 *
 * It has to exist. Without it the hook reported `creditState(balance ?? 0)` on a
 * null balance, which is `'empty'` — so for the first few hundred milliseconds after
 * the builder mounted, a PT with a full wallet was indistinguishable from one with
 * none, and tapping ✦ in that window opened the out-of-credits sheet. Callers must
 * treat `'loading'` as "don't know yet" and disable the action, never as a synonym
 * for either answer.
 */
export type CreditBalanceState = CreditState | 'loading';

export type CreditBalanceData = {
  loading: boolean;
  error: string | null;
  /** Null when this account has no wallet — a client, or a PT from before M3. */
  balance: number | null;
  state: CreditBalanceState;
  refetch: () => Promise<void>;
};

/**
 * The wallet balance the builder footer and the AI screen both read. The
 * footer is where the cost of a draft is decided, which is why the number
 * lives next to the action rather than behind a menu.
 */
export function useCreditBalance(userId: string | undefined): CreditBalanceData {
  const [state, setState] = useState<{
    balance: number | null;
    loading: boolean;
    error: string | null;
  }>({ balance: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ balance: null, loading: false, error: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchBalance(userId).then((result) => {
      if (!cancelled) setState({ balance: result.balance, loading: false, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const result = await fetchBalance(userId);
    setState({ balance: result.balance, loading: false, error: result.error });
  }, [userId]);

  return {
    ...state,
    state: state.loading ? 'loading' : creditState(state.balance ?? 0),
    refetch,
  };
}

import type { Database } from '@forge/shared';
import type { AuthMFAListFactorsResponse, Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../supabase';

type UserRow = Database['public']['Tables']['users']['Row'];
type PtProfileRow = Database['public']['Tables']['pt_profiles']['Row'];
type MfaFactors = AuthMFAListFactorsResponse['data'];

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: UserRow | null;
  ptProfile: PtProfileRow | null;
  mfaFactors: MfaFactors;
};

const initialState: AuthState = {
  status: 'loading',
  session: null,
  user: null,
  ptProfile: null,
  mfaFactors: null,
};

const AuthContext = createContext<AuthState>(initialState);

/**
 * Fetches the public.users row (and, when the role is 'pt', the pt_profiles row) plus
 * the MFA factor list for the current session. Called on SIGNED_IN and USER_UPDATED —
 * the two events where the underlying rows may have changed since the last fetch.
 */
async function loadProfile(
  userId: string,
): Promise<{ user: UserRow | null; ptProfile: PtProfileRow | null; mfaFactors: MfaFactors }> {
  const [{ data: user }, { data: mfaData }] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.auth.mfa.listFactors(),
  ]);

  let ptProfile: PtProfileRow | null = null;
  if (user?.role === 'pt') {
    const { data } = await supabase.from('pt_profiles').select('*').eq('user_id', userId).maybeSingle();
    ptProfile = data ?? null;
  }

  return { user: user ?? null, ptProfile, mfaFactors: mfaData ?? null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let cancelled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === 'SIGNED_OUT') {
        setState({ status: 'signedOut', session: null, user: null, ptProfile: null, mfaFactors: null });
        return;
      }

      if (!session) {
        setState({ status: 'signedOut', session: null, user: null, ptProfile: null, mfaFactors: null });
        return;
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        // Refetch users/pt_profiles: these are the events where the underlying rows may
        // have actually changed (first load, sign-in, or an explicit user update).
        void loadProfile(session.user.id).then((profile) => {
          if (cancelled) return;
          setState({ status: 'signedIn', session, ...profile });
        });
        return;
      }

      // TOKEN_REFRESHED, MFA_CHALLENGE_VERIFIED, PASSWORD_RECOVERY, etc. — the profile
      // rows haven't changed, just refresh the session object. If no profile has loaded
      // yet (e.g. a brand-new recovery session), stay in 'loading' rather than claiming
      // 'signedIn' with a null user — the root gate keys off user/ptProfile being present.
      setState((prev) => ({
        status: prev.user ? 'signedIn' : 'loading',
        session,
        user: prev.user,
        ptProfile: prev.ptProfile,
        mfaFactors: prev.mfaFactors,
      }));
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  return use(AuthContext);
}

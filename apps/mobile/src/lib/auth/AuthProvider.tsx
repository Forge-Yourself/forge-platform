import { isNetworkError, type Database } from '@forge/shared';
import type { AuthMFAListFactorsResponse, Session } from '@supabase/supabase-js';
import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { getStoredValue } from '../deviceStore';
import { engine, OFFLINE_CHOICE_KEY } from '../offline/engine';
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
  /**
   * The `clients.id` of this PT's own training record, or null when they have
   * not opted in (and always null for every other role). Minted lazily by
   * ensureSelfClient(), never here — this only reads what already exists, so a
   * PT who never taps "train myself" accumulates no row.
   *
   * It is the id every `/me` screen passes where a client id is expected, and
   * the flag that tells a body or session screen "this subject is the viewer".
   */
  selfClientId: string | null;
};

const initialState: AuthState = {
  status: 'loading',
  session: null,
  user: null,
  ptProfile: null,
  mfaFactors: null,
  selfClientId: null,
};

const AuthContext = createContext<AuthState>(initialState);

/**
 * Fetches the public.users row (and, when the role is 'pt', the pt_profiles row) plus
 * the MFA factor list for the current session. Called on SIGNED_IN and USER_UPDATED —
 * the two events where the underlying rows may have changed since the last fetch.
 */
type CachedProfile = { user: UserRow; ptProfile: PtProfileRow | null; selfClientId?: string | null };

async function loadProfile(
  userId: string,
): Promise<{
  user: UserRow | null;
  ptProfile: PtProfileRow | null;
  mfaFactors: MfaFactors;
  selfClientId: string | null;
}> {
  const [{ data: user, error: userError }, { data: mfaData }] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).maybeSingle(),
    supabase.auth.mfa.listFactors(),
  ]);

  // M4b cold offline boot: with offline logging switched on for this device,
  // a profile read that never reached the server falls back to the last one
  // we saw for this same user id, so the gate can let a basement session in.
  const offlineChoice = (await getStoredValue(OFFLINE_CHOICE_KEY)) === '1';
  if (!user && offlineChoice && isNetworkError(userError)) {
    const cached = await engine.getCache<CachedProfile>('profile:' + userId);
    if (cached) {
      return {
        user: cached.value.user,
        ptProfile: cached.value.ptProfile,
        mfaFactors: mfaData ?? null,
        // Written since M4e; a payload cached before it is simply "no self row".
        selfClientId: cached.value.selfClientId ?? null,
      };
    }
  }

  let ptProfile: PtProfileRow | null = null;
  let selfClientId: string | null = null;
  if (user?.role === 'pt') {
    // Both reads belong to the same role branch, so they go out together.
    // The self row is the one where the PT is also the subject; uq_clients_self
    // makes "at most one" a database guarantee, so maybeSingle cannot throw.
    const [{ data: profile }, { data: selfRow }] = await Promise.all([
      supabase.from('pt_profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('clients')
        .select('id')
        .eq('pt_user_id', userId)
        .eq('client_user_id', userId)
        .maybeSingle(),
    ]);
    ptProfile = profile ?? null;
    selfClientId = selfRow?.id ?? null;
  }

  if (user && offlineChoice) void engine.putCache('profile:' + userId, { user, ptProfile, selfClientId });

  return { user: user ?? null, ptProfile, mfaFactors: mfaData ?? null, selfClientId };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let cancelled = false;
    // Bumped on every event that kicks off a loadProfile() fetch. A slow fetch from an
    // earlier event (e.g. the previous user's SIGNED_IN, right before a fast sign-out /
    // sign-in-as-someone-else) checks its own captured requestId against the latest one
    // before applying its result, so it can't clobber fresher state that already landed —
    // the same stale-async problem Gate's user-id-keyed remount solves one layer down,
    // solved here with a request counter instead since AuthProvider itself can't remount.
    let requestId = 0;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;

      if (event === 'SIGNED_OUT') {
        requestId += 1;
        setState({ status: 'signedOut', session: null, user: null, ptProfile: null, mfaFactors: null, selfClientId: null });
        return;
      }

      if (!session) {
        requestId += 1;
        setState({ status: 'signedOut', session: null, user: null, ptProfile: null, mfaFactors: null, selfClientId: null });
        return;
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        // Refetch users/pt_profiles: these are the events where the underlying rows may
        // have actually changed (first load, sign-in, or an explicit user update).
        requestId += 1;
        const thisRequestId = requestId;
        void loadProfile(session.user.id).then((profile) => {
          if (cancelled || thisRequestId !== requestId) return;
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
        selfClientId: prev.selfClientId,
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

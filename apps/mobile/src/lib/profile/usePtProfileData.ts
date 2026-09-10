import type { Database } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type PtProfileRow = Database['public']['Tables']['pt_profiles']['Row'];
export type PtCertificationRow = Database['public']['Tables']['pt_certifications']['Row'];

export type PtProfileData = {
  loading: boolean;
  error: string | null;
  ptProfile: PtProfileRow | null;
  certifications: PtCertificationRow[];
  refetch: () => Promise<void>;
};

async function fetchPtProfileData(
  userId: string,
): Promise<{ ptProfile: PtProfileRow | null; certifications: PtCertificationRow[]; error: string | null }> {
  const [profileResult, certsResult] = await Promise.all([
    supabase.from('pt_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('pt_certifications')
      .select('*')
      .eq('pt_user_id', userId)
      .order('created_at', { ascending: true }),
  ]);

  if (profileResult.error || certsResult.error) {
    return {
      ptProfile: null,
      certifications: [],
      error: profileResult.error?.message ?? certsResult.error?.message ?? 'Failed to load profile',
    };
  }
  return { ptProfile: profileResult.data ?? null, certifications: certsResult.data ?? [], error: null };
}

/**
 * Independent read path for `pt_profiles` + `pt_certifications`, shared by
 * (onboarding)/pt-profile, (app)/profile and (app)/profile-edit — the three screens
 * that all need to show/edit both of these tables.
 *
 * AuthProvider (lib/auth/AuthProvider.tsx) caches a `ptProfile` too, but only
 * refetches it on SIGNED_IN/USER_UPDATED/INITIAL_SESSION auth events, and it never
 * fetches `pt_certifications` at all. A screen that just upserted a bio or inserted a
 * certification row needs to see that write reflected immediately, not after an
 * unrelated auth event happens to land — so this hook queries both tables directly
 * and exposes `refetch` for callers to invoke right after their own writes finish.
 * (See lib/auth/refreshProfile.ts for the complementary fix on AuthProvider's side —
 * used for the `pt_profiles`/`users` fields the gate itself reads.)
 */
export function usePtProfileData(userId: string | undefined): PtProfileData {
  const [ptProfile, setPtProfile] = useState<PtProfileRow | null>(null);
  const [certifications, setCertifications] = useState<PtCertificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mount/userId-change fetch: inlined here (same shape as (app)/index.tsx's
  // reachability check) rather than calling `refetch` below, so every setState call
  // stays inside a .then() the linter can see directly in this effect's own body —
  // calling out to a separately-defined callback from an effect trips
  // react-hooks/set-state-in-effect even when that callback's own setState calls are
  // themselves properly deferred.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      // Deferred into a microtask, not called synchronously in the effect body — same
      // constraint as the fetch path below, just for the no-user-yet case.
      void Promise.resolve().then(() => {
        if (!cancelled) setLoading(false);
      });
      return;
    }
    // Clearing any stale error from a previous userId is folded into the .then()
    // below rather than done synchronously here first — same constraint as the
    // no-userId branch above.
    void fetchPtProfileData(userId).then((result) => {
      if (cancelled) return;
      setError(result.error);
      if (!result.error) {
        setPtProfile(result.ptProfile);
        setCertifications(result.certifications);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Exposed for callers to invoke after their own writes (e.g. profile-edit.tsx saving
  // a bio) — an ordinary function call from an event handler, never from an effect, so
  // it isn't subject to the same lint constraint as the mount effect above.
  const refetch = useCallback(async (): Promise<void> => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setError(null);
    const result = await fetchPtProfileData(userId);
    if (result.error) {
      setError(result.error);
    } else {
      setPtProfile(result.ptProfile);
      setCertifications(result.certifications);
    }
    setLoading(false);
  }, [userId]);

  return { loading, error, ptProfile, certifications, refetch };
}

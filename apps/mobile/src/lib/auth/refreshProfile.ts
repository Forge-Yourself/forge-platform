import { supabase } from '../supabase';

/**
 * AuthProvider (lib/auth/AuthProvider.tsx) only refetches `public.users` /
 * `public.pt_profiles` on the SIGNED_IN, USER_UPDATED and INITIAL_SESSION auth
 * events. A plain `supabase.from('users'|'pt_profiles'|...).update()/insert()/upsert()`
 * call changes the underlying row but fires none of those — so `useAuth().user` /
 * `useAuth().ptProfile` (and anything that reads them, notably the root gate in
 * app/_layout.tsx) goes stale until some unrelated auth event happens to land.
 *
 * `supabase.auth.updateUser({})` is a documented no-op auth update (no email,
 * password, or metadata change) that Supabase still round-trips as a real user
 * update and broadcasts as USER_UPDATED — the cheapest way to force AuthProvider's
 * listener to re-run its profile fetch and pick up whatever was just written.
 *
 * Call this after any direct write to `public.users` or `public.pt_profiles` whose
 * result the gate or another screen needs to see right away (role selection,
 * onboarding completion, profile edits). Not needed for `public.pt_certifications`
 * writes — AuthProvider doesn't cache that table at all; screens that show
 * certifications read them independently (see lib/profile/usePtProfileData.ts).
 */
export async function refreshAuthProfile(): Promise<void> {
  await supabase.auth.updateUser({});
}

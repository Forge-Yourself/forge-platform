import { useAuth, type AuthState } from './AuthProvider';

/**
 * Thin convenience wrapper around useAuth() for call sites that only care about the
 * session/user shape and not that it happens to come from the auth context. Same
 * underlying state — kept as a separate export per the plan's file list.
 */
export function useSession(): AuthState {
  return useAuth();
}

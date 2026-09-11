import type { ClientState, Database } from '@forge/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';

export type ClientRow = Database['public']['Tables']['clients']['Row'];
export type ClientListItem = ClientRow & { displayName: string; avatarUrl: string | null };

export type ClientListFilter = 'all' | Extract<ClientState, 'active' | 'paused' | 'invited'>;

type RawState = {
  rows: ClientListItem[];
  loading: boolean;
  error: string | null;
};

/**
 * Fetches a PT's full roster once, then filters client-side by search text and
 * state — the roster is small at M2 scale (no pagination anywhere upstream
 * yet), so a second round-trip per keystroke would be pure overhead. If the
 * roster grows large enough for this to matter, the fix is server-side
 * search (an RPC or a view), not a rewrite of this hook's shape.
 *
 * Linked client names come from a second query against `users` rather than a
 * PostgREST embed — `clients` has two FKs into `users` (pt_user_id and
 * client_user_id), so an embed needs a constraint-name hint that's easy to
 * get wrong with no way to test it against a live app in this environment;
 * two plain queries merged here are simple to verify by reading.
 */
async function fetchRoster(ptUserId: string): Promise<{ rows: ClientListItem[]; error: string | null }> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('pt_user_id', ptUserId)
    .order('created_at', { ascending: false });

  if (error) {
    return { rows: [], error: error.message };
  }

  const linkedIds = (clients ?? [])
    .map((c) => c.client_user_id)
    .filter((id): id is string => id !== null);

  let namesById: Record<string, { display_name: string; avatar_url: string | null }> = {};
  if (linkedIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, display_name, avatar_url')
      .in('id', linkedIds);
    namesById = Object.fromEntries((users ?? []).map((u) => [u.id, u]));
  }

  const rows: ClientListItem[] = (clients ?? []).map((c) => {
    const linked = c.client_user_id ? namesById[c.client_user_id] : undefined;
    return {
      ...c,
      displayName: linked?.display_name ?? c.invite_name ?? c.invite_email ?? 'Unnamed client',
      avatarUrl: linked?.avatar_url ?? null,
    };
  });

  return { rows, error: null };
}

export type ClientListData = {
  loading: boolean;
  error: string | null;
  /** After search + state filtering. */
  items: ClientListItem[];
  /** True roster is empty — the empty state, not the no-match state. */
  isEmpty: boolean;
  /** Roster has clients, but none match the current search — the no-match state. */
  isNoMatch: boolean;
  refetch: () => Promise<void>;
};

export function useClientList(
  ptUserId: string | undefined,
  search: string,
  stateFilter: ClientListFilter,
): ClientListData {
  const [raw, setRaw] = useState<RawState>({ rows: [], loading: true, error: null });

  // Mount/ptUserId-change fetch inlined here (same shape as
  // usePtProfileData.ts) rather than calling `refetch` below, so every
  // setState call stays inside a .then() the linter can see directly in this
  // effect's own body — calling out to a separately-defined callback from an
  // effect trips react-hooks/set-state-in-effect even when that callback's
  // own setState calls are themselves properly deferred.
  useEffect(() => {
    let cancelled = false;
    if (!ptUserId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setRaw({ rows: [], loading: false, error: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchRoster(ptUserId).then((result) => {
      if (!cancelled) setRaw({ rows: result.rows, loading: false, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [ptUserId]);

  // Exposed for callers to invoke after their own writes (invite/pause/etc.) — an
  // ordinary function call from an event handler, never from an effect.
  const refetch = useCallback(async (): Promise<void> => {
    if (!ptUserId) {
      setRaw({ rows: [], loading: false, error: null });
      return;
    }
    setRaw((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetchRoster(ptUserId);
    setRaw({ rows: result.rows, loading: false, error: result.error });
  }, [ptUserId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return raw.rows.filter((r) => {
      if (stateFilter !== 'all' && r.state !== stateFilter) return false;
      if (q && !r.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [raw.rows, search, stateFilter]);

  return {
    loading: raw.loading,
    error: raw.error,
    items: filtered,
    isEmpty: !raw.loading && !raw.error && raw.rows.length === 0,
    isNoMatch: !raw.loading && !raw.error && raw.rows.length > 0 && filtered.length === 0,
    refetch,
  };
}

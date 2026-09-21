import { isNetworkError, isSelfClientRow, splitRoster, type ClientState, type Database } from '@forge/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedFetch, OFFLINE } from '../offline/cachedFetch';
import { useOffline } from '../offline/offlineContext';
import { supabase } from '../supabase';

export type ClientRow = Database['public']['Tables']['clients']['Row'];
export type ClientListItem = ClientRow & {
  displayName: string;
  avatarUrl: string | null;
  /**
   * The PT's own training record (pt_user_id = client_user_id). It is a real
   * client row and every RPC treats it as one, but it is not somebody the PT
   * is responsible for — so it is kept out of `items` and out of every count
   * built from them. See useClientList below for what that protects.
   */
  isSelf: boolean;
};

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
export async function fetchRoster(ptUserId: string): Promise<{ rows: ClientListItem[]; error: string | null }> {
  const { data: clients, error } = await supabase
    .from('clients')
    .select('*')
    .eq('pt_user_id', ptUserId)
    .order('created_at', { ascending: false });

  if (error) {
    return { rows: [], error: isNetworkError(error) ? OFFLINE : error.message };
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
      isSelf: isSelfClientRow(c),
    };
  });

  return { rows, error: null };
}

export type ClientListData = {
  loading: boolean;
  error: string | null;
  /** After search + state filtering. Never contains the self row. */
  items: ClientListItem[];
  /** Roster size before search/state filtering — the "3 of 12 clients" denominator. */
  total: number;
  /** True roster is empty — the empty state, not the no-match state. */
  isEmpty: boolean;
  /** Roster has clients, but none match the current search — the no-match state. */
  isNoMatch: boolean;
  /**
   * The PT's own training record, handed out separately so callers must decide
   * about it rather than inherit it. Screens that ask "who am I responsible
   * for" (the roster list, usePtDashboard) ignore it; screens that ask "whose
   * record can I act on" (the assign picker, the AI draft picker) put it back.
   */
  selfItem: ClientListItem | null;
  refetch: () => Promise<void>;
};

export function useClientList(
  ptUserId: string | undefined,
  search: string,
  stateFilter: ClientListFilter,
): ClientListData {
  const offline = useOffline();
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
    void cachedFetch({ enabled: offline.effective, online: offline.online }, 'roster:' + ptUserId, () =>
      fetchRoster(ptUserId),
    ).then((result) => {
      if (!cancelled) setRaw({ rows: result.rows, loading: false, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [ptUserId, offline.effective, offline.online]);

  // Exposed for callers to invoke after their own writes (invite/pause/etc.) — an
  // ordinary function call from an event handler, never from an effect.
  const refetch = useCallback(async (): Promise<void> => {
    if (!ptUserId) {
      setRaw({ rows: [], loading: false, error: null });
      return;
    }
    setRaw((prev) => ({ ...prev, loading: true, error: null }));
    const result = await cachedFetch({ enabled: offline.effective, online: offline.online }, 'roster:' + ptUserId, () =>
      fetchRoster(ptUserId),
    );
    setRaw({ rows: result.rows, loading: false, error: result.error });
  }, [ptUserId, offline.effective, offline.online]);

  // The self row is split off BEFORE anything counts or filters. Leaving it in
  // would not just add a stray row: usePtDashboard counts every active client
  // without a signed waiver as "awaiting intake", and the self record has no
  // intake by design — so that tile would read 1 forever, and "Needs you"
  // would carry a row titled with the PT's own name. The empty state matters
  // too: a PT who only trains themselves must still be told to invite someone.
  const split = useMemo(() => splitRoster(raw.rows), [raw.rows]);
  const roster = split.roster;
  const selfItem = split.self;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((r) => {
      if (stateFilter !== 'all' && r.state !== stateFilter) return false;
      if (q && !r.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [roster, search, stateFilter]);

  return {
    loading: raw.loading,
    error: raw.error,
    items: filtered,
    total: roster.length,
    isEmpty: !raw.loading && !raw.error && roster.length === 0,
    isNoMatch: !raw.loading && !raw.error && roster.length > 0 && filtered.length === 0,
    selfItem,
    refetch,
  };
}

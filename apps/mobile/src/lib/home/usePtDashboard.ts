import { useEffect, useMemo, useState } from 'react';
import { useClientList, type ClientListItem } from '../clients/useClientList';
import { useProgramList, type ProgramListItem } from '../programs/useProgramList';
import { supabase } from '../supabase';

/** Why a client is on the Today list. Ordered by how early it blocks the work. */
export type AttentionReason = 'invited' | 'flags' | 'waiver' | 'noProgram';

export type AttentionItem = {
  clientId: string;
  name: string;
  avatarUrl: string | null;
  reason: AttentionReason;
  /** Red-flag count — only set when `reason` is 'flags'. */
  count?: number;
};

type IntakeFlag = { clientId: string; state: string; flagCount: number };

export type PtDashboardData = {
  loading: boolean;
  error: string | null;
  /** Everyone still on the roster — deactivated clients are not "yours" to act on. */
  activeClients: ClientListItem[];
  /** Assigned, non-draft programs currently running. */
  runningProgramCount: number;
  runningPrograms: ProgramListItem[];
  /**
   * Roster clients whose intake is not through the waiver yet. RLS hides an
   * intake row until it is submitted, so "no row" counts as awaiting too.
   */
  awaitingIntakeCount: number;
  attention: AttentionItem[];
};

/**
 * Everything the PT's Today screen shows, assembled from data that already exists.
 *
 * The screen it replaced rendered a boot-diagnostics card (colour scheme, layout
 * direction, a Supabase reachability probe) and a typography specimen — scaffolding
 * from M0 that was never swapped out. Nothing here is invented: the roster, the
 * programs and the submitted intakes are the same three sources the Clients,
 * Programs and client-detail screens read. There is deliberately no "today's
 * sessions" list, because scheduling does not exist until M5 and a fake one would
 * be worse than none.
 *
 * RLS note: `intake_forms_pt_select` returns nothing to a PT until the client
 * submits, so a row coming back here is itself the proof that the intake is in.
 * A client with no row is either mid-intake or hasn't started, which is a state
 * this list intentionally does not nag about — the Clients screen owns that.
 */
export function usePtDashboard(ptUserId: string | undefined): PtDashboardData {
  const clients = useClientList(ptUserId, '', 'all');
  const programs = useProgramList('assigned');

  /**
   * `settledKey` is the roster this state was fetched FOR, and loading is
   * derived from it rather than stored.
   *
   * A stored flag could not express the gap: the first pass runs with an empty
   * roster, settles {rows: [], loading: false}, and nothing re-armed it when the
   * roster then arrived — so for the commit in between, a PT with red-flagged
   * clients was shown a settled, empty "Needs attention" list. Comparing the
   * settled key against the current one closes that window inside a single
   * render, with no extra commit and nothing to remember to reset.
   */
  const [flags, setFlags] = useState<{
    settledKey: string | null;
    rows: IntakeFlag[];
    error: string | null;
  }>({ settledKey: null, rows: [], error: null });

  // Keyed on the id list rather than the array identity so this refires when the
  // roster actually changes, not on every re-render of the hook above it.
  const clientIdKey = clients.items.map((c) => c.id).sort().join(',');
  const flagsLoading = flags.settledKey !== clientIdKey;

  useEffect(() => {
    let cancelled = false;
    const ids = clientIdKey === '' ? [] : clientIdKey.split(',');
    const key = clientIdKey;
    if (ids.length === 0) {
      void Promise.resolve().then(() => {
        if (!cancelled) setFlags({ settledKey: key, rows: [], error: null });
      });
      return () => {
        cancelled = true;
      };
    }
    // Inlined .then() so every setState stays visible inside this effect body —
    // the same react-hooks/set-state-in-effect constraint useClientList documents.
    void supabase
      .from('intake_forms')
      .select('client_id, state, red_flags')
      .in('client_id', ids)
      .then(({ data, error }) => {
        if (cancelled) return;
        // The error was previously destructured away. A failure left rows empty
        // and loading false, which reads downstream as "nobody needs attention"
        // — so a client with three PAR-Q red flags silently vanished from the
        // PT's safety list with no banner anywhere on the screen.
        if (error) {
          setFlags({ settledKey: key, rows: [], error: error.message });
          return;
        }
        setFlags({
          settledKey: key,
          rows: (data ?? []).map((row) => ({
            clientId: row.client_id,
            state: row.state,
            flagCount: Array.isArray(row.red_flags) ? row.red_flags.length : 0,
          })),
          error: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientIdKey]);

  const activeClients = useMemo(
    () => clients.items.filter((c) => c.state !== 'deactivated'),
    [clients.items],
  );

  const runningPrograms = useMemo(
    () => programs.items.filter((p) => p.state === 'active'),
    [programs.items],
  );

  const awaitingIntakeCount = useMemo(() => {
    const signed = new Set(flags.rows.filter((f) => f.state === 'waiver_signed').map((f) => f.clientId));
    return activeClients.filter((c) => !signed.has(c.id)).length;
  }, [activeClients, flags.rows]);

  const attention = useMemo(() => {
    const flagByClient = new Map(flags.rows.map((f) => [f.clientId, f]));
    const programmedClientIds = new Set(
      programs.items.filter((p) => p.state !== 'draft').map((p) => p.client_id),
    );

    const items: AttentionItem[] = [];
    for (const client of activeClients) {
      const base = { clientId: client.id, name: client.displayName, avatarUrl: client.avatarUrl };
      const intake = flagByClient.get(client.id);

      // One row per client, not one per problem: a roster of six with three
      // issues each would bury the one that actually blocks session one.
      if (client.state === 'invited') {
        items.push({ ...base, reason: 'invited' });
      } else if (intake && intake.flagCount > 0 && intake.state !== 'waiver_signed') {
        items.push({ ...base, reason: 'flags', count: intake.flagCount });
      } else if (intake && intake.state !== 'waiver_signed') {
        items.push({ ...base, reason: 'waiver' });
      } else if (!programmedClientIds.has(client.id)) {
        items.push({ ...base, reason: 'noProgram' });
      }
    }

    const order: Record<AttentionReason, number> = { flags: 0, waiver: 1, invited: 2, noProgram: 3 };
    return items.sort((a, b) => order[a.reason] - order[b.reason]);
  }, [activeClients, flags.rows, programs.items]);

  return {
    loading: clients.loading || programs.loading || flagsLoading,
    error: clients.error ?? programs.error ?? flags.error,
    activeClients,
    runningProgramCount: runningPrograms.length,
    runningPrograms,
    awaitingIntakeCount,
    attention,
  };
}

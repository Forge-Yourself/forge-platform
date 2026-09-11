import type { Database, IntakeResponses, IntakeSummary } from '@forge/shared';
import { intakeSummary } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type ClientRow = Database['public']['Tables']['clients']['Row'];
export type IntakeFormRow = Database['public']['Tables']['intake_forms']['Row'];
type LinkedUser = { display_name: string; avatar_url: string | null };

export type IntakeProgress = {
  state: string;
  answeredSections: number;
  totalSections: number;
};

export type ClientDetailData = {
  loading: boolean;
  error: string | null;
  client: ClientRow | null;
  clientUser: LinkedUser | null;
  /**
   * Null while the intake is still pending/in_progress — RLS
   * (`intake_forms_pt_select`) denies the PT that row until it's submitted.
   * `progress` below is the PT's only pre-submit visibility.
   */
  intake: IntakeFormRow | null;
  progress: IntakeProgress | null;
  summary: IntakeSummary | null;
  refetch: () => Promise<void>;
};

async function fetchClientDetail(
  clientId: string,
  unitSystem: 'metric' | 'imperial',
): Promise<Omit<ClientDetailData, 'loading' | 'refetch'>> {
  const [clientResult, progressResult] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
    supabase.rpc('intake_progress', { p_client_id: clientId }),
  ]);

  if (clientResult.error || !clientResult.data) {
    return {
      error: clientResult.error?.message ?? 'Client not found',
      client: null,
      clientUser: null,
      intake: null,
      progress: null,
      summary: null,
    };
  }

  const client = clientResult.data;

  let clientUser: LinkedUser | null = null;
  if (client.client_user_id) {
    const { data } = await supabase
      .from('users')
      .select('display_name, avatar_url')
      .eq('id', client.client_user_id)
      .maybeSingle();
    clientUser = data ?? null;
  }

  // RLS returns zero rows (not an error) while the intake is still
  // pending/in_progress — `.maybeSingle()` surfaces that as `data: null`.
  const { data: intake } = await supabase.from('intake_forms').select('*').eq('client_id', clientId).maybeSingle();

  const progressRow = progressResult.data?.[0];
  const progress: IntakeProgress | null = progressRow
    ? {
        state: progressRow.state,
        answeredSections: progressRow.answered_sections,
        totalSections: progressRow.total_sections,
      }
    : null;

  const summary = intake
    ? intakeSummary(
        (intake.responses ?? {}) as Partial<IntakeResponses>,
        unitSystem,
        (intake.red_flags as string[] | null) ?? undefined,
      )
    : null;

  return { error: null, client, clientUser, intake: intake ?? null, progress, summary };
}

export function useClientDetail(
  clientId: string | undefined,
  unitSystem: 'metric' | 'imperial',
): ClientDetailData {
  const [state, setState] = useState<Omit<ClientDetailData, 'loading' | 'refetch'>>({
    error: null,
    client: null,
    clientUser: null,
    intake: null,
    progress: null,
    summary: null,
  });
  const [loading, setLoading] = useState(true);

  // Mount/dependency-change fetch inlined here (same shape as
  // usePtProfileData.ts) rather than calling `refetch` below — see
  // useClientList.ts's identical comment for why.
  useEffect(() => {
    let cancelled = false;
    if (!clientId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchClientDetail(clientId, unitSystem).then((result) => {
      if (cancelled) return;
      setState(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, unitSystem]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await fetchClientDetail(clientId, unitSystem);
    setState(result);
    setLoading(false);
  }, [clientId, unitSystem]);

  return { ...state, loading, refetch };
}

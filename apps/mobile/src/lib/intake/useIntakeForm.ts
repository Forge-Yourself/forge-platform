import type { Database, IntakeResponses } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

export type IntakeFormRow = Database['public']['Tables']['intake_forms']['Row'];

export type IntakeFormData = {
  loading: boolean;
  error: string | null;
  row: IntakeFormRow | null;
  /**
   * Merges `partial` into the row's `responses` and writes it with
   * `state = 'in_progress'` — a plain RLS-scoped update, allowed directly by
   * `intake_forms_client_update` while the row is pending/in_progress. No
   * local draft cache: every call round-trips to the server immediately,
   * which is what makes cross-device resume true rather than merely
   * advertised.
   */
  saveProgress: (partial: Partial<IntakeResponses>) => Promise<void>;
  /** Calls the `submit_intake` RPC, which derives red flags server-side. */
  submit: (responses: IntakeResponses) => Promise<void>;
  refetch: () => Promise<void>;
};

async function fetchIntakeForm(intakeId: string): Promise<{ row: IntakeFormRow | null; error: string | null }> {
  const { data, error } = await supabase.from('intake_forms').select('*').eq('id', intakeId).maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: data ?? null, error: data ? null : 'Intake form not found' };
}

export function useIntakeForm(intakeId: string | undefined): IntakeFormData {
  const [row, setRow] = useState<IntakeFormRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mount/id-change fetch inlined with .then() — same
  // react-hooks/set-state-in-effect constraint as every other data hook in
  // this milestone (see useClientList.ts's comment for the full reasoning).
  useEffect(() => {
    let cancelled = false;
    if (!intakeId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchIntakeForm(intakeId).then((result) => {
      if (cancelled) return;
      setRow(result.row);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [intakeId]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!intakeId) return;
    setLoading(true);
    const result = await fetchIntakeForm(intakeId);
    setRow(result.row);
    setError(result.error);
    setLoading(false);
  }, [intakeId]);

  const saveProgress = useCallback(
    async (partial: Partial<IntakeResponses>): Promise<void> => {
      if (!row) return;
      const merged = { ...((row.responses as Partial<IntakeResponses>) ?? {}), ...partial };
      const { data, error: updateError } = await supabase
        .from('intake_forms')
        .update({ responses: merged, state: 'in_progress' })
        .eq('id', row.id)
        .select()
        .maybeSingle();
      if (updateError) throw updateError;
      if (data) setRow(data);
    },
    [row],
  );

  const submit = useCallback(
    async (responses: IntakeResponses): Promise<void> => {
      if (!intakeId) return;
      const { error: submitError } = await supabase.rpc('submit_intake', {
        p_intake_id: intakeId,
        p_responses: responses,
      });
      if (submitError) throw submitError;
      await refetch();
    },
    [intakeId, refetch],
  );

  return { loading, error, row, saveProgress, submit, refetch };
}

import { programTreeSchema, type ProgramTree } from '@forge/shared';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

async function fetchTree(
  programId: string,
): Promise<{ tree: ProgramTree | null; error: string | null }> {
  const { data, error } = await supabase.rpc('program_tree', { p_program_id: programId });
  if (error) return { tree: null, error: error.message };
  if (data === null) return { tree: null, error: 'not_found' };

  // Parsed rather than cast: a shape drift between the SQL that builds this
  // JSONB and the TypeScript that renders it should surface here, at the
  // boundary, and not as an `undefined` three screens deeper.
  const parsed = programTreeSchema.safeParse(data);
  if (!parsed.success) {
    return { tree: null, error: 'unexpected_shape' };
  }
  return { tree: parsed.data, error: null };
}

export type ProgramTreeData = {
  loading: boolean;
  error: string | null;
  tree: ProgramTree | null;
  refetch: () => Promise<void>;
};

/**
 * The whole program in one call. Shared by the PT's builder and the client's
 * read-only view, deliberately: program_tree() is invoker-rights, so RLS is
 * the single authorization path for both and there is no second code path to
 * keep in sync.
 */
export function useProgramTree(programId: string | undefined): ProgramTreeData {
  const [state, setState] = useState<{
    tree: ProgramTree | null;
    loading: boolean;
    error: string | null;
  }>({ tree: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!programId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ tree: null, loading: false, error: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void fetchTree(programId).then((result) => {
      if (!cancelled) setState({ tree: result.tree, loading: false, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [programId]);

  const refetch = useCallback(async (): Promise<void> => {
    if (!programId) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const result = await fetchTree(programId);
    setState({ tree: result.tree, loading: false, error: result.error });
  }, [programId]);

  return { ...state, refetch };
}

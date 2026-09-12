import type { ResolvedDraft, SaveProgramPayload } from '@forge/shared';
import { draftToSaveProgramPayload } from '@forge/shared';
import { supabase } from '../supabase';

/**
 * Thin wrappers around the program RPCs from
 * supabase/migrations/0007_m3_programming.sql. No business logic here — the
 * database owns all of it: authorization, the deep copies, archive-then-
 * activate, and audit logging. These just call `.rpc()` and rethrow so
 * callers can route failures through useAsyncSubmit's existing pattern.
 */

export async function createProgram(
  name: string,
  durationWeeks: number,
  clientId?: string,
  isTemplate = false,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_program', {
    p_name: name,
    p_duration_weeks: durationWeeks,
    p_client_id: clientId,
    p_is_template: isTemplate,
  });
  if (error) throw error;
  return data;
}

/** Replaces the program's whole tree in one call — ~160 rows, one round trip. */
export async function saveProgram(programId: string, payload: SaveProgramPayload): Promise<void> {
  const { error } = await supabase.rpc('save_program', {
    p_program_id: programId,
    p_payload: payload,
  });
  if (error) throw error;
}

export async function copyProgramWeek(
  programId: string,
  fromWeek: number,
  toWeek: number,
): Promise<void> {
  const { error } = await supabase.rpc('copy_program_week', {
    p_program_id: programId,
    p_from_week: fromWeek,
    p_to_week: toWeek,
  });
  if (error) throw error;
}

export async function copyProgram(programId: string, asTemplate = true): Promise<string> {
  const { data, error } = await supabase.rpc('copy_program', {
    p_program_id: programId,
    p_as_template: asTemplate,
  });
  if (error) throw error;
  return data;
}

export async function assignProgram(
  programId: string,
  clientId: string,
  startDate: string,
): Promise<void> {
  const { error } = await supabase.rpc('assign_program', {
    p_program_id: programId,
    p_client_id: clientId,
    p_start_date: startDate,
  });
  if (error) throw error;
}

/** Deep-copies the template into a new program. The source is never mutated. */
export async function instantiateTemplate(
  templateId: string,
  clientId: string,
  startDate: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('instantiate_template', {
    p_template_id: templateId,
    p_client_id: clientId,
    p_start_date: startDate,
  });
  if (error) throw error;
  return data;
}

export async function archiveProgram(programId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_program', { p_program_id: programId });
  if (error) throw error;
}

/**
 * The only call that ever persists an AI draft. It lands as state 'draft',
 * which is invisible to the client until the PT assigns it — EP-15's "AI
 * never auto-publishes", enforced by there being no other path.
 */
export async function createProgramFromDraft(
  clientId: string,
  generationId: string,
  draft: ResolvedDraft,
  name?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_program_from_draft', {
    p_client_id: clientId,
    p_generation_id: generationId,
    p_payload: draftToSaveProgramPayload(draft),
    p_name: name,
  });
  if (error) throw error;
  return data;
}

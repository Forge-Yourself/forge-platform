import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Equipment } from '@forge/shared';
import { AI_CATALOGUE_LIMIT } from './model';

export type Catalogue = {
  /** One line per exercise, exactly as the prompt renders it. */
  block: string;
  /** slug -> exercise id, for resolving the model's picks afterwards. */
  idsBySlug: Map<string, string>;
  /** slug -> display name, so the draft can be rendered without a second query. */
  namesBySlug: Map<string, string>;
  count: number;
};

/**
 * Builds the list of movements the model is allowed to choose from.
 *
 * The model picks BY SLUG from this list and nothing else, which is what
 * stops it inventing exercises the library does not have — and why the route
 * can resolve every pick to a real exercise_id afterwards.
 *
 * Read through the caller's own bearer client, so exercises_select decides
 * what is in the catalogue: the global library plus this PT's own custom
 * movements, never another trainer's.
 */
export async function buildCatalogue(
  bearer: SupabaseClient<Database>,
  equipment: Equipment[],
): Promise<Catalogue> {
  let query = bearer
    .from('exercises')
    .select('id, slug, name, muscle_group, equipment, movement_pattern')
    .eq('is_active', true)
    .limit(AI_CATALOGUE_LIMIT);

  // An empty selection would mean "no equipment at all", which is not what a
  // PT means by leaving it blank — the request schema requires at least one,
  // so this is belt and braces.
  if (equipment.length > 0) {
    query = query.in('equipment', equipment);
  }

  const { data, error } = await query;
  if (error) throw new Error('catalogue query failed: ' + error.message);

  const rows = (data ?? []).filter((row): row is typeof row & { slug: string } => row.slug !== null);

  const idsBySlug = new Map(rows.map((row) => [row.slug, row.id]));
  const namesBySlug = new Map(rows.map((row) => [row.slug, row.name]));

  const block = rows
    .map(
      (row) =>
        row.slug + ' | ' + row.name + ' | ' + row.muscle_group + ' | ' + row.movement_pattern + ' | ' + row.equipment,
    )
    .join('\n');

  return { block, idsBySlug, namesBySlug, count: rows.length };
}

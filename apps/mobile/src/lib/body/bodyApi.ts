import type { BodyMetricInput, Database, PhotoPose } from '@forge/shared';
import { PROGRESS_PHOTO_BUCKET } from '@forge/shared';
import { supabase } from '../supabase';

export type BodyMetricRow = Database['public']['Tables']['body_metrics']['Row'];
export type ProgressPhotoRow = Database['public']['Tables']['progress_photos']['Row'];

/**
 * Thin typed wrappers over 0017. Every write is an RPC keyed on a
 * client-generated id, so a double tap or a retry after a timeout returns the
 * first row instead of making a second one.
 */
export async function fetchBodyMetrics(
  clientId: string,
  sinceIso: string,
): Promise<{ rows: BodyMetricRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('*')
    .eq('client_id', clientId)
    .gte('measured_at', sinceIso)
    .order('measured_at', { ascending: true })
    .limit(1000);
  return { rows: data ?? [], error: error?.message ?? null };
}

export async function recordBodyMetric(input: BodyMetricInput): Promise<{ row: BodyMetricRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('record_body_metric', {
    p_id: input.id,
    p_client_id: input.client_id,
    ...(input.measured_at ? { p_measured_at: input.measured_at } : {}),
    ...(input.weight_kg !== null ? { p_weight_kg: input.weight_kg } : {}),
    ...(input.body_fat_pct !== null ? { p_body_fat_pct: input.body_fat_pct } : {}),
    ...(input.circumferences !== null ? { p_circumferences: input.circumferences } : {}),
    ...(input.note !== null ? { p_note: input.note } : {}),
  });
  if (error) return { row: null, error };
  return { row: data ?? null, error: null };
}

export async function deleteBodyMetric(id: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('delete_body_metric', { p_id: id });
  return { error };
}

/** RLS already hides unshared photos from the PT, so this is "what the caller may see". Newest first. */
export async function fetchPhotos(clientId: string): Promise<{ rows: ProgressPhotoRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('progress_photos')
    .select('*')
    .eq('client_id', clientId)
    .order('taken_at', { ascending: false })
    .limit(500);
  return { rows: data ?? [], error: error?.message ?? null };
}

export async function countVisiblePhotos(clientId: string): Promise<number> {
  const { count } = await supabase
    .from('progress_photos')
    .select('id', { head: true, count: 'exact' })
    .eq('client_id', clientId);
  return count ?? 0;
}

export async function recordProgressPhoto(args: {
  id: string;
  clientId: string;
  pose: PhotoPose;
  takenAt: string;
  share: boolean;
}): Promise<{ row: ProgressPhotoRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('record_progress_photo', {
    p_id: args.id,
    p_client_id: args.clientId,
    p_pose_type: args.pose,
    p_taken_at: args.takenAt,
    p_share: args.share,
  });
  if (error) return { row: null, error };
  return { row: data ?? null, error: null };
}

export async function setPhotoShared(id: string, shared: boolean): Promise<{ row: ProgressPhotoRow | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('set_photo_shared', { p_id: id, p_shared: shared });
  if (error) return { row: null, error };
  return { row: data ?? null, error: null };
}

/**
 * Objects first, through the Storage API, while the row still authorises
 * 0017's DELETE policy; then the row. SQL cannot delete objects on this
 * project (storage.protect_delete). If the remove fails the row stays and the
 * user can retry; if the RPC fails after the remove, the next retry finds no
 * objects to remove and deletes the row.
 */
export async function deleteProgressPhoto(photo: Pick<ProgressPhotoRow, 'id' | 'photo_path' | 'thumbnail_path'>): Promise<{ error: Error | null }> {
  const removed = await supabase.storage.from(PROGRESS_PHOTO_BUCKET).remove([photo.photo_path, photo.thumbnail_path]);
  if (removed.error) return { error: removed.error };
  const { error } = await supabase.rpc('delete_progress_photo', { p_id: photo.id });
  return { error };
}

/** 60-second signed URLs (spec D1). Missing keys are paths the caller may not sign. */
export async function signPhotoPaths(paths: string[]): Promise<{ urls: Record<string, string>; error: string | null }> {
  if (paths.length === 0) return { urls: {}, error: null };
  const { data, error } = await supabase.storage.from(PROGRESS_PHOTO_BUCKET).createSignedUrls(paths, 60);
  if (error) return { urls: {}, error: error.message };
  const urls: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
  }
  return { urls, error: null };
}

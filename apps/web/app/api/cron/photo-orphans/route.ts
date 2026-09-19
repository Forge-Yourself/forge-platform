import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/photo-orphans — daily (vercel.json crons).
 *
 * Removes progress-photo objects that have no row: uploads whose
 * record_progress_photo never landed, and objects a device failed to remove
 * after deleting the row. Through the Storage API, because SQL cannot delete
 * objects on this project (storage.protect_delete) and a SQL delete would
 * orphan the blob anyway (M4c plan, Corrections).
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on
 * the project. Without the secret configured, the route refuses everyone.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('progress_photo_orphans', { p_older_than: '24 hours', p_limit: 500 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const names = (data ?? []) as string[];
  let removed = 0;
  for (let i = 0; i < names.length; i += 100) {
    const { data: gone, error: removeError } = await supabase.storage.from('progress-photos').remove(names.slice(i, i + 100));
    if (removeError) return Response.json({ error: removeError.message, found: names.length, removed }, { status: 500 });
    removed += gone?.length ?? 0;
  }
  return Response.json({ found: names.length, removed });
}

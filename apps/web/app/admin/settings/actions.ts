'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';

/** Runs under the admin's own session; the RPC's is_admin() check is the real gate. */
export async function setOfflineMode(formData: FormData): Promise<void> {
  const mode = String(formData.get('mode') ?? '');
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { error } = await supabase.rpc('admin_set_offline_logging', { p_mode: mode });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/settings');
}

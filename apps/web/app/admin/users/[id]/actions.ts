'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createClient } from '@/lib/supabase/server';

export async function setOfflineBeta(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  const enabled = formData.get('enabled') === 'true';
  const supabase = await createClient();
  await requireAdmin(supabase);
  const { error } = await supabase.rpc('admin_set_offline_beta', { p_user_id: userId, p_enabled: enabled });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/users/' + userId);
}

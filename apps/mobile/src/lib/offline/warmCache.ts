import type { Database } from '@forge/shared';

export async function warmCache(_user: Database['public']['Tables']['users']['Row']): Promise<string | null> {
  return null;
}

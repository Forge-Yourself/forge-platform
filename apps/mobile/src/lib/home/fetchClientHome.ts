import { isNetworkError, type Database } from '@forge/shared';
import { OFFLINE } from '../offline/cachedFetch';
import { supabase } from '../supabase';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type IntakeRow = Database['public']['Tables']['intake_forms']['Row'];

export type ClientHomeData = {
  client: ClientRow | null;
  ptInfo: { display_name: string; avatar_url: string | null } | null;
  intake: IntakeRow | null;
  error: string | null;
};

export async function fetchClientHome(userId: string): Promise<ClientHomeData> {
  // `.limit(1)` is defensive, not a fix for anything known: maybeSingle THROWS
  // on more than one row, and nothing stops the same person being invited by
  // two PTs. Ordering makes the one it picks the oldest rather than arbitrary.
  // (A PT's own self row can never surface here — this is only ever called on
  // the non-PT branch — but the query should not depend on that to be safe.)
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('client_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { client: null, ptInfo: null, intake: null, error: isNetworkError(error) ? OFFLINE : error.message };
  if (!client) return { client: null, ptInfo: null, intake: null, error: null };
  const [{ data: ptInfo }, { data: intake }] = await Promise.all([
    supabase.from('users').select('display_name, avatar_url').eq('id', client.pt_user_id).maybeSingle(),
    supabase.from('intake_forms').select('*').eq('client_id', client.id).maybeSingle(),
  ]);
  return { client, ptInfo: ptInfo ?? null, intake: intake ?? null, error: null };
}

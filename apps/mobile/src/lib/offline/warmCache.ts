import type { Database } from '@forge/shared';
import { fetchClientDetail } from '../clients/useClientDetail';
import { fetchRoster } from '../clients/useClientList';
import { fetchClientHome } from '../home/fetchClientHome';
import { fetchInProgress } from '../logging/useInProgressSession';
import { loadWeek } from '../logging/loadWeek';
import { cachedFetch } from './cachedFetch';
import { engine } from './engine';
import { fetchLastSets } from './fetchLastSets';

type UserRow = Database['public']['Tables']['users']['Row'];

const ON = { enabled: true, online: true };

async function warmClient(clientId: string, name: string | null, unit: 'metric' | 'imperial'): Promise<void> {
  await Promise.all([
    cachedFetch(ON, 'client:' + clientId, () => fetchClientDetail(clientId, unit)),
    cachedFetch(ON, 'week:' + clientId, () => loadWeek(clientId)),
    cachedFetch(ON, 'last:' + clientId, () => fetchLastSets(clientId)),
    engine.putCache('clientName:' + clientId, { name }),
  ]);
}

/**
 * Spec §6: everything an offline start needs, fetched ahead of time. Runs the
 * same fetchers the screens run, so the cache holds exactly what they read.
 * Returns the warm time, or null when the roster itself could not be read.
 */
export async function warmCache(user: UserRow): Promise<string | null> {
  const unit = (user.unit_system as 'metric' | 'imperial' | null) ?? 'metric';
  await cachedFetch(ON, 'inprogress', fetchInProgress);

  if (user.role === 'pt') {
    const roster = await cachedFetch(ON, 'roster:' + user.id, () => fetchRoster(user.id));
    if (roster.error !== null) return null;
    for (const c of roster.rows.filter((r) => r.state === 'active')) {
      await warmClient(c.id, c.displayName, unit);
    }
  } else {
    const home = await cachedFetch(ON, 'clientHome:' + user.id, () => fetchClientHome(user.id));
    if (home.error !== null) return null;
    if (home.client) await warmClient(home.client.id, user.display_name, unit);
  }

  const at = new Date().toISOString();
  await engine.putCache('warmedAt', at);
  return at;
}

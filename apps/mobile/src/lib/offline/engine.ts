import { SyncEngine } from '@forge/shared';
import { kvStore } from './kvStore';
import { supabaseTransport } from './transport';

/** Device-level, so one per process, not per render or per provider mount. */
export const engine = new SyncEngine(kvStore, supabaseTransport);

/** deviceStore keys. The choice is per device (spec §4.3); the mode is the last one the server told us. */
export const OFFLINE_CHOICE_KEY = 'forge.offlineLogging';
export const OFFLINE_MODE_KEY = 'forge.offlineMode';

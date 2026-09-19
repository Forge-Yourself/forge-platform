import type { Database } from '../database.types';

export type SessionRow = Database['public']['Tables']['workout_sessions']['Row'];
export type SetRow = Database['public']['Tables']['sets']['Row'];

/** The exact RPC arguments. The outbox stores these verbatim and replays them. */
export type StartArgs = {
  p_client_id: string;
  p_program_day_id: string | null;
  p_id: string;
  p_started_at: string;
};
export type LogSetArgs = {
  p_id: string;
  p_session_id: string;
  p_exercise_id: string;
  p_set_number: number;
  p_weight_kg: number | null;
  p_reps: number | null;
  p_rpe: number | null;
  p_notes: string | null;
  p_is_warmup: boolean;
  p_device_id: string | null;
};
export type DeleteSetArgs = { p_id: string };
export type CompleteArgs = {
  p_session_id: string;
  p_rating: number | null;
  p_notes: string | null;
  p_completed_at: string;
};

/** `sessionId` is the local session id the op belongs to; the engine rewrites it on a merge. */
export type OutboxOp =
  | { op: 'start'; sessionId: string; args: StartArgs }
  | { op: 'log_set'; sessionId: string; args: LogSetArgs }
  | { op: 'delete_set'; sessionId: string; args: DeleteSetArgs }
  | { op: 'complete'; sessionId: string; args: CompleteArgs };

export type RpcError = { code: string; message: string };
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };

export type OutboxEntry = OutboxOp & {
  seq: number;
  attempts: number;
  lastError: RpcError | null;
  state: 'pending' | 'failed';
  createdAt: string;
};

export interface Transport {
  start(args: StartArgs): Promise<RpcResult<SessionRow>>;
  logSet(args: LogSetArgs): Promise<RpcResult<{ set: SetRow; newPrs: string[] }>>;
  deleteSet(args: DeleteSetArgs): Promise<RpcResult<null>>;
  complete(args: CompleteArgs): Promise<RpcResult<SessionRow>>;
  /** One session refresh. True when a fresh access token is now in place. */
  refreshAuth(): Promise<boolean>;
}

export type KvTable = 'outbox' | 'sessions' | 'sets' | 'aliases' | 'cache' | 'meta';
/** `value: null` deletes the key. */
export type KvWrite = { table: KvTable; key: string; value: unknown };

/**
 * The whole storage seam. Adapters (SQLite native, IndexedDB web, memory in
 * tests) implement exactly this; every rule lives above it in SyncEngine.
 * `all` returns rows sorted by key ascending. `write` is atomic.
 */
export interface KvStore {
  get<T>(table: KvTable, key: string): Promise<T | null>;
  all<T>(table: KvTable): Promise<Array<{ key: string; value: T }>>;
  write(batch: readonly KvWrite[]): Promise<void>;
  clear(): Promise<void>;
}

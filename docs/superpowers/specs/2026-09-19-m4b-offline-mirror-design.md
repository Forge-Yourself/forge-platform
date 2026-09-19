# M4b · Offline and Live Mirror — Design

**Date:** 2026-09-19
**Scope:** The second of four M4 sub-milestones. Offline start and logging behind a two-level feature switch, a local store with an outbox that replays the M4a RPCs, a Supabase Realtime live mirror between the PT and the client on one session, an offline chip, and a sync queue view.
**Parent:** `2026-09-18-m4a-log-core-design.md` §1 (the M4 split). `2026-09-09-forge-v1-implementation-design.md` §"Offline logging (EP-05)".

---

## 1. Goal

A trainer in a basement gym with no signal can open the app, pick a client, start the programmed day and log every set. The sets survive an app kill and reach the server when the signal comes back. When a PT and a client are both on the same session and online, each sees the other's sets appear without refreshing.

Offline logging is **off by default** and ships dark. The product runs online-first; offline is enabled per user for testing, then globally when it has earned trust. With it off, every screen behaves exactly as M4a built it.

## 2. State of the ground

- Every logging write already goes through four RPCs wrapped in `apps/mobile/src/lib/logging/sessionRpc.ts`: `start_workout_session`, `log_set`, `delete_set`, `complete_workout_session`. `log_set` and `delete_set` are idempotent on a client-generated ULID.
- `start_workout_session` is **server-keyed**: it generates the session UUID, and under M4a D4 returns the existing in-progress session for the client if one exists. An offline start has no id to log against.
- `log_set` rejects sessions that are not `in_progress`.
- `sets` carries `is_synced`, `synced_at`, `conflict_resolved`, `device_id` since `0001`. M4a writes `is_synced = TRUE` on every server write.
- `sets` is partitioned by month on `created_at`; the ULID's first 48 bits already encode the client-side millisecond it was generated.
- `useSession.ts` reads straight from PostgREST and applies optimistic edits with `applySet` / `removeSet`.
- Helpers `is_pt_of_client`, `is_client_record_owner`, `is_session_participant`, `is_admin` exist.
- `lib/deviceStore.ts` is a per-device key/value shim (SecureStore native, localStorage web).
- No `app_config` table exists. No NetInfo, no `expo-sqlite` dependency.
- The project develops on the Expo **web** target. `expo-sqlite` on web needs wasm plus COOP/COEP headers and is experimental.

## 3. Decisions

- **D1 · Start and log offline.** Scope covers starting a session and logging into it with no signal. Offline history, library search and the program builder stay online-only. Rejected: log-only (the session must already exist, which is not what happens in a basement gym); full offline roster and history (a much larger cache for little floor value).
- **D2 · Client-generated session id.** `start_workout_session` gains `p_id UUID DEFAULT NULL`. The same `p_id` twice yields one row. If another in-progress session already exists for the client, the RPC returns that one and the client rewrites its local id (§5.3).
- **D3 · Storage seam.** One `LocalStore` interface; `SqliteStore` on native (`expo-sqlite`), `IdbStore` on web (IndexedDB). All sync logic sits above the seam as pure TypeScript, so it is unit-tested with an in-memory store and screen-walked on web with Chrome's offline emulation. Rejected: `expo-sqlite` web backend (experimental, needs cross-origin isolation headers); native-only offline (nothing walkable on the dev target, violates PITFALLS V1).
- **D4 · Replay the RPCs directly.** The outbox calls the same four RPCs M4a calls online. There is no `/api/sync` endpoint; this supersedes the v1 spec's line about one.
- **D5 · Last arrival wins.** No version checks, no rejected-edit conflicts. Whatever reaches the server last is the row. Rights are still enforced by the RPCs (M4a §4.3), so a client can never overwrite a PT's set whatever the order.
- **D6 · Late sets append to completed sessions.** `log_set` and `delete_set` accept a session whose status is `completed`. The status stays `completed`; the set appears on the summary. `duration_min` is `completed_at − started_at` and does not change; volume is computed on read. PRs are evaluated as for any first insert. Rejected: reopening the session, because under M4a D4 a reopened session becomes the one the client's next workout resumes into, days later.
- **D7 · Broadcast from the database for the mirror.** Triggers on `sets` and `workout_sessions` call `realtime.broadcast_changes()` to a private topic per session; channel authorization is an RLS policy on `realtime.messages`. Rejected: `postgres_changes` (needs `publish_via_partition_root` on a partitioned table, per-subscriber RLS evaluation on every event, harder to assert in the harness); polling (not live).
- **D8 · Warm cache on sign-in and foreground.** The data needed to start offline is fetched ahead of time, not lazily (§6).
- **D9 · Two-level switch, default off.** Availability is decided by the server; the choice is the user's, per device (§4.3).
- **D10 · Order by ULID.** Screens order a session's sets by ULID (client time) and renumber per exercise for display. `set_number` is sent as the device computed it; uniqueness is not enforced. No new column.

## 4. Data and authorization — migration `0016_m4b_offline_mirror.sql`

### 4.1 RPC changes

- `start_workout_session(p_client_id UUID, p_program_day_id UUID DEFAULT NULL, p_id UUID DEFAULT NULL) RETURNS workout_sessions`
  - `p_id` given and a row with that id exists → authorize as before, return it unchanged.
  - Otherwise, an `in_progress` session exists for the client → return it (M4a D4, unchanged).
  - Otherwise insert with `id = COALESCE(p_id, uuid_v7())`. `p_id` must be a valid UUID; nothing else about it is trusted.
  - A `p_id` that exists but belongs to a different client → `42501`.
- `log_set(…)`: the `status = 'in_progress'` check becomes `status IN ('in_progress', 'completed')`. Everything else unchanged.
- `delete_set(…)`: same widening.
- `complete_workout_session`: unchanged (already idempotent).

The generated types are regenerated (`pnpm types:gen`) and `sessionRpc.ts` gains the `p_id` argument.

### 4.2 Live mirror

- `broadcast_session_set()` trigger function, `AFTER INSERT OR UPDATE OR DELETE ON sets FOR EACH ROW` (declared on the partitioned parent, so it fires for every partition). Calls `realtime.broadcast_changes('session:' || workout_session_id, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD)`.
- `broadcast_session_row()`, `AFTER UPDATE ON workout_sessions`, topic `'session:' || id`.
- `realtime.messages` policy, `FOR SELECT TO authenticated`: `realtime.topic()` matches `session:<uuid>` and `is_session_participant(<uuid>) OR is_admin()`. No INSERT policy: no client can broadcast.
- Clients subscribe with `{ config: { private: true } }`.

### 4.3 Feature switch

- `app_config (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ)`; RLS: SELECT for `authenticated`, writes service-role only. Seeded `('offline_logging', '"off"')`. Values `off | beta | all`.
- `users.offline_logging_beta BOOLEAN NOT NULL DEFAULT FALSE`. Not writable by the user: excluded from the self-update path the same way `role` is.
- **Available** = `offline_logging = 'all'`, or `offline_logging = 'beta'` and the user's `offline_logging_beta`.
- **Chosen** = device key `forge.offlineLogging` in `deviceStore`, default off. Per device, because the cache and the queue are per device.
- **Effective** = available and chosen. Resolved at boot and on foreground by a pure function in `packages/shared`.
- Turning the device toggle off while the queue is non-empty is refused, with a "Discard N pending" confirm as the only way through.
- If availability goes off while the queue is non-empty, the queue still drains. Only new offline enqueueing stops. Pending work is never dropped silently.

## 5. Mobile architecture

```
screens ── useSession / start sheet / roster hooks
              │
        LoggingRepo ─── online path: sessionRpc (M4a, unchanged)
              │
              └──────── offline path (effective switch on)
                              │
                        SyncEngine (pure TS)
                              │
                        LocalStore ── SqliteStore (native) / IdbStore (web)
                              ▲
        RealtimeMirror ───────┘  merges broadcasts by id
```

All new code under `apps/mobile/src/lib/offline/`, except the pure engine and resolver, which live in `packages/shared` so vitest covers them.

### 5.1 Units

| Unit | Does | Depends on |
|---|---|---|
| `LocalStore` (interface) | Tables: `sessions`, `sets`, `outbox`, `aliases`, `cache_meta`, plus cached reads (`roster`, `program_trees`, `last_sets`). Transactional `enqueue` + row write. | — |
| `SqliteStore` | `LocalStore` over `expo-sqlite`. | `expo-sqlite` |
| `IdbStore` | `LocalStore` over IndexedDB. | browser |
| `MemoryStore` | `LocalStore` for tests. | — |
| `SyncEngine` | Coalesce, drain FIFO, classify errors, rewrite ids, backoff. | `LocalStore`, `Transport` |
| `Transport` | The four RPCs. Production impl is `sessionRpc`; tests use a fake. | supabase |
| `LoggingRepo` | The only thing screens call for logging reads and writes. Routes to online or offline path. | the above |
| `Connectivity` | `@react-native-community/netinfo` plus "last RPC failed with a network error". Emits online/offline. | netinfo |
| `CacheWarmer` | Fills the read cache (§6). | supabase, `LocalStore` |
| `RealtimeMirror` | Subscribes to `session:<id>` while a session screen is mounted; feeds payloads to the same merge functions replay uses. | supabase realtime |

Screens stop importing `sessionRpc` directly. With the switch off, `LoggingRepo` is a passthrough to it, so the M4a paths are the same code as today.

### 5.2 Outbox

Row: `seq` (autoincrement), `op` (`start | log_set | delete_set | complete`), `payload` (the exact RPC arguments), `session_local_id`, `attempts`, `last_error`, `state` (`pending | failed`), `created_at`.

A write is one local transaction: the optimistic row in `sessions`/`sets` plus the outbox row. It survives an app kill.

**Coalescing**, applied at enqueue time to pending rows only:
- `log_set` for a ULID that already has a pending `log_set` → replace its payload.
- `delete_set` for a ULID whose `log_set` is still pending → drop both.

Nothing else coalesces.

### 5.3 Replay

Strict FIFO, one call at a time, because a session's `start` must land before its sets.

Drain triggers: connectivity back, app to foreground, right after an enqueue, and a backoff timer after a transient failure.

**Session id rewrite.** An offline start creates the session locally with a client UUID `L` and queues `start(p_id = L)`. On replay:
- The RPC returns `L` → done.
- It returns another id `S` (another device or the PT started first) → in one local transaction: rewrite `L → S` in every pending payload, in `sessions` and `sets.workout_session_id`, and record `aliases(L → S)`. A session screen open on `L` resolves through the alias and `router.replace`s to `S`. The local sets then replay into `S`, which is the merge.

**Error classes**, extending M4a's `mapLoggingError`:

| Class | Examples | Action |
|---|---|---|
| transient | network error, timeout, 5xx, `PGRST` connection errors | stay at head; backoff 2 s, 4 s, 8 s … capped at 60 s |
| auth | expired JWT | one `supabase.auth.refreshSession()`; on failure pause the queue and show "Sign in to sync N sets." Signing out with a non-empty queue warns first |
| permanent | `42501`, `23514`, `P0001` | mark `failed`, move on. A failed `start` fails every later op for the same session with it |

**Merge.** A server row (from a replay response, a refetch or a broadcast) replaces the local row with the same id. Last arrival wins (D5). Echoes of the device's own pending writes are ignored until that write is acknowledged, so a stale broadcast cannot roll back an optimistic edit.

### 5.4 Reads with the switch on

`useSession`, the start sheet, the Clients tab, client detail and the client's Today read from `LocalStore` first and refresh from the server when online. The server result is merged in and written back to the store. With the switch off they read from the server exactly as in M4a.

## 6. Cache warming

On sign-in, on foreground when online, and after a sync drain:

- **Client persona:** own client row, the active program tree, and the last completed working set per exercise in that tree.
- **PT persona:** roster rows (display name, status, intake-submitted flag), and for each active client the active program tree and the last completed working set per exercise in it.
- Any session currently `in_progress` for those clients, with its sets.

`cache_meta` records when each part was warmed; the offline chip shows that time. A PT with thirty clients is low hundreds of KB. Nothing else is cached.

## 7. UI

- **Offline chip.** Shown at the top of `(app)` screens when the switch is effective and either the device is offline or the queue is non-empty. Copy: "Offline · synced 14:02", "Offline · 4 pending", "Syncing 4…". Tapping it opens the queue view. Hidden when online and the queue is empty.
- **Live badge** on the session screen header: "Live" with a success dot while the mirror channel is joined; "Offline" when it is not. Present whether or not offline logging is on. It replaces M4a's "No live-mirror badge — M4b" note.
- **Sync queue** `/(app)/sync-queue`: one row per outbox entry ("Set · Bench press 80 kg × 8 · Ahmad"), state, and for failed rows the mapped reason with Retry and Discard. Footer: Retry all. `EmptyState` when clean. Own back control (PITFALLS N1), Back via `dismissTo` (N15). Reachable from the chip and from Settings.
- **Settings:** an "Offline logging (beta)" row with a switch and a one-line explainer, rendered only when available. The pending count is shown under it.
- **Online-only screens while offline:** `EmptyState` "You're offline. This needs a connection." with a Back.
- **M4a's offline retry copy** stays for the switch-off path.
- New i18n keys land in `en.json` and `ar.json` in the same order (I1); interpolated names have a no-name variant (I3).
- New components (`OfflineChip`, `LiveBadge`, `SyncQueueRow`) are recorded in `DESIGN_SYSTEM_GAPS.md`.

## 8. Admin web

- `/admin/settings`: the `offline_logging` mode (`off | beta | all`), service-role write.
- `/admin/users/[id]`: an Offline beta toggle for `offline_logging_beta`.
- Session inspector: a `device_id` column, and a "late" tag on sets whose ULID time is after the session's `completed_at`.

## 9. Dependencies

`expo-sqlite`, `@react-native-community/netinfo`. IndexedDB needs no package.

## 10. Testing

- **SQL harness** (`db/rls_assertions.sql`): the same `p_id` twice yields one row; `p_id` when another in-progress session exists returns the existing one; a `p_id` owned by another client is denied; `log_set` into a completed session is accepted, its PR evaluated, the status still `completed`; `delete_set` on a completed session works within M4a rights; a stranger cannot read `realtime.messages` for a session topic while the PT, the client and an admin can; nobody can insert into `realtime.messages`; a set insert on a partition produces a broadcast row; `offline_logging_beta` is not self-writable; `app_config` is readable and not writable by `authenticated`.
- **Vitest:** `SyncEngine` against a fake `Transport` and `MemoryStore`: FIFO, both coalescing rules, the `L → S` rewrite including queued payloads and the alias, transient backoff, the auth pause, the permanent-failure cascade from a failed start, kill-and-resume (rebuild the engine on the same store and continue), and merge idempotency between replay and broadcast. The availability resolver matrix.
- **Screen walk** (`forge-screen-walk`, web target, both `@forge.dev` roles, offline via DevTools `Network.emulateNetworkConditions`):
  1. PT offline: Clients → client → Start → log three sets → reload the page → the sets are still there and the chip says "3 pending" → online → drains → psql confirms the rows.
  2. Mirror: PT and client in two browser contexts on one session; the client logs a set and it appears on the PT's screen without a refresh.
  3. Merge: the client starts offline, the PT starts online, the client reconnects and lands on the PT's session id with its sets merged.
  4. Late set: the PT finishes, the offline client logs a set, reconnects; the set shows on the summary and the inspector tags it "late".
  5. Switch: toggle off with a queue is refused; mode `off` hides the Settings row and M4a behaviour is unchanged.
- **Live DB** (psql, read-only): `sets.device_id`, `is_synced`, the session ids after the merge walk.
- **Native:** a `SqliteStore` smoke run on a device once a dev-client build exists. Recorded as open, not claimed.

## 11. Out of scope, by name

- Offline history, library search, program builder, roster beyond §6.
- Background sync while the app is killed (OS background tasks).
- Conflict UI beyond the queue view; version checks on edits.
- Offline body metrics and photos → M4c.
- Lock-screen timer, iPad console, voice → M4d.
- PR re-evaluation on edit, delete or late sets arriving out of order.

## 12. Corrections to source documents

- The v1 spec's "idempotent `/api/sync` endpoint keyed on ULID" is superseded by D4: the outbox replays the RPCs directly.
- M4a §6.1 "No live-mirror badge — M4b" is replaced by §7's Live badge.
- M4a §4.2 "Either party logs into whichever session is in progress" is extended: sets may also append to a completed session (D6).

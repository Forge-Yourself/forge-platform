# M4c · Body — Design

**Date:** 2026-09-19
**Scope:** The third of four M4 sub-milestones. Body metrics entry (weight, body fat, six circumferences), trend charts with a plateau flag, progress photos with a live pose-guided camera, a photo timeline and side-by-side compare, and the encryption decision for photos. Online only.
**Parent:** `2026-09-18-m4a-log-core-design.md` §1 (the M4 split). `2026-09-09-forge-v1-implementation-design.md` §5 M4 and §7 (the progress-photo deviation). Architecture EP-06. Prototype artboard `metrics`.

---

## 1. Goal

A PT standing with a client can record a weigh-in and a waist measurement in a few taps, see the eight-week trend, and see at a glance when weight has stalled. A client can take progress photos lined up against their last ones, keep them private, and choose to share them with their PT. Either of them can put two dates side by side.

## 2. State of the ground

- `body_metrics` and `progress_photos` exist since `0001` (baseline) with RLS enabled and no policies: default-deny. No code reads or writes them.
- `body_metrics`: `weight_kg NUMERIC(5,2)`, `body_fat_pct NUMERIC(4,1)`, `circumferences JSONB` (unconstrained), `source` (`manual` | `smart_scale`), `measured_at`. No author column.
- `progress_photos`: `photo_url`, `thumbnail_url`, `encryption_key_id VARCHAR(100) NOT NULL`, `pose_type` nullable (`front`, `back`, `side_left`, `side_right`, `custom`), `is_shared_with_pt DEFAULT FALSE`, `taken_at`. No author column.
- Helpers `is_pt_of_client`, `is_client_record_owner`, `is_admin` exist (`0003`). M4a's writes check `is_pt_of_client OR is_client_record_owner` and nothing about client status; M4c matches.
- The only Storage bucket is `waivers` (`0005`), private and service-role only. No `storage.objects` policies exist yet.
- `users.unit_system` (`metric` | `imperial`) exists; client detail and the session screen already convert on display.
- `react-native-svg` is a dependency. `expo-camera`, `expo-image-picker` and `expo-image-manipulator` are not.
- Client detail (`clients/[id]/index.tsx`) and the client's Today tab (`(tabs)/index.tsx`) are the two natural entry points.
- The prototype has a `metrics` artboard and nothing for photos. Its annotations: segmented weight / body fat / waist, chart and entry follow the selection; trend line only, no bars, no grid; eight weeks is the window a PT reviews; entry is a ± stepper, not a keyboard; history repeats the delta per row.

## 3. Decisions

- **D1 · Photos: private bucket, RLS, signed URLs, encryption at rest.** This confirms the deviation already in v1 spec §7 and supersedes EP-06's "E2E encryption by default" and "thumbnail and full-image keys differ". Supabase Storage encrypts at rest (AES-256); the bucket is private; only the client and, when shared, their PT can sign a URL; URLs live 60 seconds. Rejected: server-side envelope encryption through a Next.js broker (meets "keys differ" literally but the server still reads every photo, and every view pays a hop); true E2E with per-user keypairs (a lost device loses the photos, PT sharing needs key re-wrapping, and web/native crypto parity is a milestone of its own). `encryption_key_id` is dropped.
- **D2 · Who writes.** Metrics: the client or their PT, recorded per row in `recorded_by_user_id`, like `sets.logged_by_user_id`. Photos: either may take them. A client's photo is private by default and shared only when the client turns sharing on. A PT's photo is shared by definition (the PT already saw the client to take it); the client may still turn sharing off, and only the client may ever change the flag.
- **D3 · Online only.** Neither metrics nor photos go through the M4b outbox. Save is disabled with a reason when there is no connection. Writes are still idempotent on a client-generated id, so a double tap or a retry after a timeout cannot duplicate a row.
- **D4 · Measurements.** Weight, body fat %, and circumferences at a fixed set of six sites: `waist`, `hips`, `chest`, `arm`, `thigh`, `neck`. Stored metric (kg, %, cm), shown in the user's `unit_system`. Adding a site later is a data-only change to the key list in the CHECK and the zod schema.
- **D5 · RPC-only writes, direct Storage upload.** Both tables are SELECT-only under RLS; every write is a SECURITY DEFINER RPC (the `0014` / `0015` pattern). The device uploads photo objects straight to the bucket under a Storage INSERT policy, then registers the row with an RPC that checks both objects exist. Rejected: a Next.js broker holding the service role (a second auth layer, CORS on every call, no rule RLS cannot express); direct table writes (breaks the house rule, and "only the client may flip sharing" is clumsy as a policy).
- **D6 · Capture.** Live `expo-camera` preview with a pose silhouette overlay and a ghost of the last photo of the same pose at about 30% opacity, toggleable. Gallery import through `expo-image-picker` as a fallback. The full image (long edge ≤ 2048 px, JPEG 0.8) and thumbnail (long edge 360 px) are made on the device with `expo-image-manipulator`; re-encoding strips EXIF, including location.
- **D7 · Chart windows.** Chips 4w · 8w · 12w · 26w, default 8w. The prototype's eight weeks is the default; EP-06's 4/12/26 are kept as the other choices.
- **D8 · Plateau.** Weight only. Take the last four ISO weeks, ending with the current week; each must hold at least one weight. Weekly value = mean of that week's weights. Plateau when (max − min) / mean of the four weekly values < 0.5%. Fewer than four qualifying weeks → no flag. Written once in SQL (`body_plateau(client_id)`) for the admin and client-detail summary, once in TS for the chart screen, with tests on both sides (PITFALLS: a rule in both languages needs tests on both).
- **D9 · Admin sees numbers, not bodies.** Admins read `body_metrics` and `progress_photos` rows. No Storage policy lets an admin sign a photo URL.

## 4. Data and security

### Migration `0017_m4c_body`

`body_metrics`:
- Add `recorded_by_user_id UUID NOT NULL REFERENCES users(id)`, `note TEXT` (≤ 500 chars).
- CHECK `circumferences`: NULL or a JSON object whose keys are all in the six sites and whose values are numbers in 10–300.
- CHECK at least one of `weight_kg`, `body_fat_pct`, `circumferences` is non-null.
- One row is one check-in: a save carries whichever values were entered. Charts read the non-null values of the selected metric.

`progress_photos`:
- `photo_url` → `photo_path`, `thumbnail_url` → `thumbnail_path` (both NOT NULL), holding bucket object paths, never URLs.
- Drop `encryption_key_id` (D1).
- Add `taken_by_user_id UUID NOT NULL REFERENCES users(id)`.
- `pose_type` becomes NOT NULL. `custom` stays allowed (gallery imports of an unguided shot).

Both tables are empty on the live project, so the column changes need no backfill.

Bucket `progress-photos`: private, 10 MB object limit, `image/jpeg` only. Object paths: `<client_id>/<photo_id>/full.jpg` and `<client_id>/<photo_id>/thumb.jpg`.

### RLS (SELECT only on both tables)

| Caller | `body_metrics` | `progress_photos` rows |
|---|---|---|
| Client (own record) | all own | all own |
| PT of the client | all | `is_shared_with_pt = TRUE` only |
| Other PT, other client | none | none |
| Admin | all | all (metadata only; see Storage) |

### Storage policies on `progress-photos`

- **SELECT** (what `createSignedUrl` needs): the path's `<photo_id>` has a row whose client the caller `is_client_record_owner`, or `is_pt_of_client` with `is_shared_with_pt = TRUE`. This is written out, not delegated to the table's RLS, because that RLS admits admins and this policy must not (D9).
- **INSERT**: the path's first segment is a client id the caller `is_pt_of_client` or `is_client_record_owner`. No upsert.
- **UPDATE / DELETE**: none. Deletion happens inside `delete_progress_photo`.

### RPCs

| RPC | Who | Behaviour |
|---|---|---|
| `record_body_metric(p_id, p_client_id, p_measured_at, p_weight_kg, p_body_fat_pct, p_circumferences, p_note)` | client or PT | Insert; same `p_id` again returns the existing row. `p_measured_at` clamped to now ± 24 h, as `0016` does for sessions. |
| `delete_body_metric(p_id)` | client (any own row) or the PT who recorded it | Delete. |
| `record_progress_photo(p_id, p_client_id, p_pose_type, p_taken_at, p_share)` | client or PT | Checks `full.jpg` and `thumb.jpg` exist under `<client>/<p_id>/`. Sets `taken_by_user_id`; `is_shared_with_pt` = `p_share` for a client, TRUE for a PT. Idempotent on `p_id`. |
| `set_photo_shared(p_id, p_shared)` | client only | Flip sharing. |
| `delete_progress_photo(p_id)` | client (any own photo) or the PT who took it | Delete the row and both objects. |
| `body_plateau(p_client_id)` | anyone who can see the client's metrics | D8, returns BOOLEAN. |

### Orphan sweep

An upload that lands without its RPC (app killed, RPC denied) leaves objects without a row. The screen retries the RPC with the same id first. A daily `pg_cron` job deletes objects under `progress-photos` older than 24 hours with no matching row.

## 5. Screens

All body screens live under `/(app)/body/[clientId]/…` and serve both personas. They own their back control, use `dismissTo` on a cold deep link (N15), work from both entry points (N13), and refetch on focus (N12).

**Entry points.**
- PT: client detail gains a **Body** card: latest weight, delta against four weeks ago, the plateau chip, and the count of shared photos. Tap opens metrics.
- Client: the Today tab gains a **Body** row opening the same screen for their own record.

**`body/[clientId]/index` — Metrics.** Follows the `metrics` artboard.
- Segments Weight / Body fat / Waist, plus a **More** chip revealing Hips, Chest, Arm, Thigh, Neck. Chart, entry and history all follow the selection.
- Large mono current value, unit, and delta over the window. Trend line only: an svg polyline with a 10% ember area fill and a dot on the last point. No grid, no bars.
- Window chips 4w · 8w · 12w · 26w, default 8w.
- Plateau chip on Weight when D8 holds: warn colour, copy "Within 0.5% for 4 weeks".
- **Log today**: a ± stepper seeded from the latest value (steps 0.1 kg / 0.2 lb, 0.5 %, 0.5 cm / 0.25 in), then **Save measurement**. With no prior value the stepper has nothing to step from, so the first value is typed.
- **History**: date, value, delta against the previous row. Long-press a row the caller may delete → confirm → `delete_body_metric`.
- Empty state: no chart, copy inviting the first measurement, entry open.

**`body/[clientId]/photos` — Timeline.**
- Pose chips All / Front / Back / Side L / Side R.
- Thumbnails grouped by date. The client sees a lock glyph on unshared photos; the PT never receives them.
- Accent **Take photos**, ghost **Compare** (disabled until two dates exist for a pose).

**`body/[clientId]/photos/capture`.**
- Pose chosen first; live camera with the pose silhouette and the ghost of the last same-pose photo (toggle).
- Shutter → review: **Retake** / **Use photo**. **Choose from library** link for imports (pose selectable, `custom` allowed).
- Client sees a **Share with my PT** switch, default off. PT sees "Photos you take are visible to you and the client. The client can hide them from you."
- No connection → **Use photo** disabled with "Needs a connection to upload".
- Camera permission denied → explanation, a button to open settings, and the library import.

**`body/[clientId]/photos/[photoId]` — Photo.** Full image via signed URL, date, pose, who took it; the client gets the share switch; delete for whoever D2 allows.

**`body/[clientId]/photos/compare`.** Pose chip, two date pickers (defaults: earliest and latest for that pose), images side by side, and under each the weight recorded closest to that date (within 7 days, else blank).

**Admin (`apps/web`).** The client page gains a read-only metrics table and photo counts (total, shared). No image is shown.

## 6. Code layout

**`packages/shared/src/body/`** (vitest):
- zod schemas for metric input and photo registration, with the same bounds as the SQL CHECKs.
- `plateau(weights)` (D8), `trendSeries(rows, metric, window)`, `delta`, and kg↔lb / cm↔in conversion.

**`apps/mobile/src/lib/body/`:**
- `bodyApi.ts`: thin wrappers over the RPCs, reads, and Storage calls.
- `photoUpload.ts`: resize and re-encode → upload `full.jpg` and `thumb.jpg` (no upsert) → `record_progress_photo`. An "object already exists" error on retry counts as uploaded.
- `useSignedUrls.ts`: batch `createSignedUrls` for the visible thumbnails, re-sign once on a 400, only the newest load may set state (O1).

**New dependencies:** `expo-camera`, `expo-image-picker`, `expo-image-manipulator`.

## 7. Errors

- No connection: save and upload disabled with the reason on screen.
- RPC denied (not your client, not your row): inline error on the screen; nothing crashes.
- Expired signed URL: re-sign once silently, then show a retry tile.
- Upload succeeded, RPC failed: retry the RPC with the same id; otherwise the sweep collects the objects.

## 8. Verification

1. **vitest:** shared schemas, `plateau`, `trendSeries`, `delta`, conversions.
2. **RLS harness (`db/rls_assertions.sql`):** the table in §4 as assertions for client, own PT, other PT, and admin; shared vs unshared rows; Storage sign and insert allowed and denied by the same matrix; a PT cannot flip sharing; a PT cannot delete a client-taken photo or a client-recorded metric; `record_progress_photo` refuses when an object is missing; `body_plateau` on seeded weeks (flat, moving, three weeks only).
3. **CI:** typecheck, lint, test.
4. **`forge-screen-walk`:** PT records a weight and sees the chart and the plateau chip on seeded data; client takes a photo on the web camera (Chrome fake media stream), keeps it private, and the PT cannot see it; client shares it and the PT sees it; compare renders two dates.

## 9. Out of scope

- Offline metrics and photos (D3).
- Smart-scale import (`source = 'smart_scale'`), wearables (EP-07, v3).
- Measurement reminders (M9 notifications).
- Body data in the session summary; the session summary's PR list.
- PT-configured measurement sites.
- iPad console, voice, Live Activity → M4d.

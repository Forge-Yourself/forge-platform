# M4d · Floor ergonomics — Design

**Date:** 2026-09-19
**Scope:** The last of four M4 sub-milestones. An iPad PT console (three panes, multi-client switcher), voice logging of the current set in English and Arabic, and a rest timer that survives the lock screen (Android ongoing notification now, iOS Live Activity written and build-verified). One small migration for Realtime Presence.
**Parent:** `2026-09-18-m4a-log-core-design.md` §1 (the M4 split). `2026-09-09-forge-v1-implementation-design.md` §5 M4. Architecture EP-05. Prototype artboards `ipad_console`, `voice`, `timer`, `lock`, `session`.

---

## 1. Goal

A PT on the gym floor runs two or three clients from one iPad without losing anyone's rest clock, logs a set by saying "one oh two point five for eight, RPE eight" (or the Arabic equivalent) with chalked hands, and puts the phone in a pocket between sets knowing the rest timer, +30s and Skip are on the lock screen.

## 2. State of the ground

- The session screen `apps/mobile/src/app/(app)/sessions/[id]/index.tsx` is 1,728 lines: `SessionScreen` (lines 124–1396) holds all state, actions and JSX; `SetRowView`, `EditSetSheet` and small tiles live at the bottom of the same file.
- `lib/logging/useRestTimer.ts` is a screen-local hook, wall-clock based (`endsAt`), with running / paused / complete phases, +30s, pause and an `onZero` callback that plays `assets/sounds/timer-done.wav`. It dies with the screen and the app. `ui/RestStrip.tsx` and `ui/RestTimer.tsx` render it.
- One in-progress session per client (enforced in `start_workout_session`); a PT may have many in-progress sessions across clients.
- Programs have weeks and days numbered 1–7, not bound to weekdays. `loadWeek()` and `weekCompletion()` compute a client's current week and its done days.
- `useSessionChannel` joins the private topic `session:<id>` for broadcast only. `0016`'s `realtime.messages` policy allows `extension = 'broadcast'` SELECT for participants and admins; there is no Presence.
- `expo-speech-recognition` 57.1 (iOS `SFSpeechRecognizer`, Android `SpeechRecognizer`, web `SpeechRecognition`) and `expo-widgets` 57.0 (Live Activities via `@expo/ui` SwiftUI) are current for SDK 57 and not installed. `expo-notifications` cannot render a countdown chronometer or handle action buttons with the app dead.
- There is no Apple developer account; the developer is on Windows. iOS cannot be installed on a device. EAS can build an unsigned iOS simulator build.
- `app.json`: `ios.supportsTablet: true`, `orientation: default`. `eas.json` has `development` (dev client, Android APK), `preview`, `production`.
- i18n has `en.json` and `ar.json`; the app is RTL-capable.

## 3. Decisions

- **D1 · One controller, two layouts.** Logging logic is extracted from the session screen into `useSessionController`; the phone layout and the iPad console compose the same panes. Rejected: a separate iPad screen (every M4a/M4b rule — outbox, PRs, late sets — would live twice).
- **D2 · Console breakpoint.** The console renders when the window is ≥ 900pt wide **and** the signed-in user is a PT. Same route (`sessions/[id]`), layout switch only. A client on a tablet gets the phone layout centred at a 600pt max width.
- **D3 · Rest clocks are per session and persisted.** A module-level store keyed by session id, persisted to `KvStore`, replaces the screen-local hook. Switching clients on the console keeps each client's rest. A rest survives an app kill.
- **D4 · The lock screen shows the soonest-ending rest** across the PT's live sessions, labelled with the client's name.
- **D5 · Lock-screen platforms.** Android: a local Expo module (`modules/forge-rest-activity`, Kotlin) with an ongoing countdown notification, +30s / Skip actions handled natively with the app dead, an exact alarm at zero, and Android 16 Live Update promotion. iOS: `expo-widgets` Live Activity with the same fields and actions, verified by an EAS simulator build only until an Apple account exists. Web and Expo Go: no-op.
- **D6 · Voice is English and Arabic.** Recognizer locale follows the app language (`en-US`; `ar-LB` falling back to `ar-SA`). The parser handles English, MSA, Lebanese dialect, code-switched speech, and Western and Eastern Arabic digits.
- **D7 · Voice parsing is deterministic and on-device.** A pure parser in `packages/shared`, no LLM: it must work offline, instantly and without credits. Rejected: parsing through the AI broker (network, cost, latency; may return later as a fallback for unparsed speech).
- **D8 · Voice fills the current set only.** Load, reps, RPE. An exercise name in the utterance is ignored, not used to switch exercise. Voice never logs without the HEARD THIS confirmation.
- **D9 · Rail source until M5.** Live (the PT's in-progress sessions), then This week (active clients whose current program week has an undone day and who have not trained today), then All clients. M5 adds Bookings above Live without redesign.
- **D10 · Presence for the mirror count.** Migration `0018` lets session participants (not admins) use Realtime Presence on `session:<id>`, so the rail can show "Live mirror on · N devices".

## 4. Data and security

### Migration `0018_m4d_presence`

- `CREATE POLICY forge_session_presence_read ON realtime.messages FOR SELECT TO authenticated USING (extension = 'presence' AND topic matches the session regex AND is_session_participant(...))`.
- `CREATE POLICY forge_session_presence_write ON realtime.messages FOR INSERT TO authenticated WITH CHECK (same predicate)`.
- No admin clause: an admin inspecting a session must not appear as a device on the client's mirror. Broadcast stays SELECT-only; clients still never broadcast.
- `db/rls_assertions.sql` gains: a participant may select and insert presence on their session topic; a non-participant may do neither; an admin may not insert presence; nobody may insert `extension = 'broadcast'`.

No other schema change. The console reads through existing SELECT policies; every write is an existing M4a/M4b RPC.

## 5. Session controller refactor

- `lib/logging/useSessionController.ts`: all state and actions now in `SessionScreen` — draft, keypad target, pending sets, current exercise, `logSet`, `deleteSet`, `editSet`, `finish`, PR view, live channel, offline flag. Returns plain data and callbacks; no JSX.
- `ui/logging/`: `SessionPlanPane` (exercise list with done counts), `SetEntryPane` (current set, keypad or steppers, Log button, mic), `SetRowView`, `EditSetSheet`, `FinishSessionSheet` (moved), plus the existing `RestStrip` / `RestTimer`.
- The phone route becomes a thin layout over controller and panes, visually and behaviourally identical to today.
- This lands as its own commit with no behaviour change, gated by a phone-width screen walk of the M4a and M4b flows before any new feature builds on it.

## 6. Rest clock

### 6.1 Store

`lib/logging/restStore.ts`: `Map<sessionId, RestState>` with `RestState = { endsAt, pausedMs, totalMs, setNumber, total, clientName, exerciseName, nextLabel }`. Persisted to `KvStore` under one key on every change; hydrated at app start. `useRest(sessionId)` returns the same shape as today's `useRestTimer` so `RestStrip` and `RestTimer` are unchanged. `onZero` (audio cue + haptic) fires once per rest per session, in the foreground only; the native alarm covers the background.

A rest is cleared when its session completes or is no longer in progress on load.

### 6.2 Pure rules — `packages/shared/src/rest/`

- `remaining(rest, now)`, `phase(rest, now)`, `plus30(rest, now)`, `togglePause(rest, now)`, `skip()` — moved from the hook, unchanged semantics.
- `soonest(rests, now)`: the running rest with the smallest `endsAt`; paused and complete rests are never chosen; ties break on session id.
- `applyNativeActions(rests, actions)`: applies `{ sessionId, action: 'plus30' | 'skip', at }` in `at` order; an action whose `(sessionId, action, at)` was already applied is ignored; an action for an unknown session is dropped.

### 6.3 `RestActivity` interface — `lib/rest-activity/`

```ts
type RestActivityPayload = {
  sessionId: string; endsAt: number; clientName: string;
  exerciseName: string; setLabel: string; nextLabel: string;
  labels: { plus30: string; skip: string; title: string };
};
interface RestActivity {
  isAvailable(): boolean;
  show(p: RestActivityPayload): Promise<void>;   // replaces any current one
  end(): Promise<void>;
  drainActions(): Promise<Array<{ sessionId: string; action: 'plus30' | 'skip'; at: number }>>;
}
```

A single JS driver subscribes to the store: whenever `soonest()` changes it calls `show` or `end`. On `AppState` → active it calls `drainActions()` and feeds `applyNativeActions`. Labels come from i18n, so the notification is in the app's language.

### 6.4 Android — `modules/forge-rest-activity`

- Local Expo module + config plugin (notification channel, `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`, receiver registration).
- `show`: ongoing notification, `setUsesChronometer(true)` + `setChronometerCountDown(true)` + `setWhen(endsAt)`, title "Bench press · set 3 of 4", text "Next: 100kg × 8 · Maya Khoury", actions +30s and Skip. On API 36+ request promotion as a Live Update. Schedules an exact alarm at `endsAt`.
- Action receiver: updates `endsAt` (+30 s) or ends the notification (Skip), reschedules or cancels the alarm, appends the action to a small SharedPreferences queue. Works with the JS runtime dead.
- Alarm receiver: posts a high-priority "Rest done" notification on a sound channel with the `timer-done` cue, and swaps the ongoing notification to a "Rest done" state.
- `drainActions`: returns and clears the queue.
- Permission: requested on the first rest start with a short rationale; denial falls back to in-app only (§9).

### 6.5 iOS — `expo-widgets` Live Activity

Same payload; a compact and expanded Live Activity with a `Text(timerInterval:)` countdown and +30s / Skip as App Intents that update the activity and append to an App Group queue read by `drainActions`. `NSSupportsLiveActivities` in the plist. Verified by an EAS `development-simulator` build (no signing). Device behaviour is recorded as untested until an Apple developer account exists.

### 6.6 Web / Expo Go

`isAvailable()` false; every call resolves as a no-op.

## 7. Voice logging

### 7.1 Parser — `packages/shared/src/voice/`

`parseSetUtterance(text: string, locale: 'en' | 'ar'): { weight?: number; unit?: 'kg' | 'lb'; reps?: number; rpe?: number; confidence: 'full' | 'partial' | 'none' }`.

- Normalisation: lowercase, strip diacritics and tatweel, Eastern Arabic digits ٠–٩ and Persian ۰–۹ → 0–9, Arabic decimal separator ٫ → `.`, unify alef/ya/ta-marbuta forms.
- English numbers: cardinals to thousands, "oh" as zero in digit sequences ("one oh two" = 102), "point five", "and a half", "a hundred and two".
- Arabic numbers: MSA and Lebanese forms (واحد، تنين/اثنين، تلاتة، … مية، ميتين، ألف), compound "خمسة وتمانين", "ونص" = .5, "فاصلة"/"نقطة" as the decimal point; transliterated Lebanese in the Latin transcript ("mitt", "tmene") where recognizers emit it.
- Slots: weight = the number adjacent to a unit word (kg, kilo, kilos, كيلو, lb, pounds, باوند) or else the first number; reps = the number after for / by / x / × / times / reps / مرة / عدة / على; RPE = the number after rpe / at / آر بي إي. Positional fallback for bare "100 8 8" is weight, reps, RPE.
- Ranges: weight 0 < w ≤ 1000 kg (converted), reps 1–100 integer, RPE 6–10 in 0.5 steps. Out-of-range values are dropped, never clamped.
- The spoken unit wins; the result carries it, and the UI converts to the user's `unit_system` for display. Storage stays kg.
- `confidence`: `full` when weight and reps are both present, `partial` when either is, `none` otherwise.
- Fixtures: `voice/fixtures.json`, ~150 utterances across the top 25 lifts' typical loads, English, Arabic and code-switched, each with the expected parse. Vitest asserts ≥ 95% parse exactly (the EP-05 acceptance line) and lists the failures.

### 7.2 Recognition — `lib/voice/useVoiceSet.ts`

- `expo-speech-recognition` with its config plugin (microphone + speech recognition permissions and usage strings in both languages).
- Locale from the app language; for Arabic, the first of `ar-LB`, `ar-SA` that `getSupportedLocales()` lists.
- `requiresOnDeviceRecognition` when the on-device model for the locale is installed; otherwise network recognition, and with no connection the mic is disabled with "Voice needs a connection on this device".
- `interimResults: true`; `contextualStrings`: "RPE", "kilo", the current exercise name. Ends on final result, ~1.5 s silence, or "Stop and use this".
- `volumechange` events drive the waveform.
- Web: the same hook over Chrome's Web Speech API.

### 7.3 Overlay — `ui/logging/VoiceSheet.tsx` (artboard `voice`)

Dark surface regardless of theme. Header "SET 3 · BENCH PRESS" and a close control.

1. **LISTENING** (ember) — waveform, transcript "…", hint "Say the load, the reps, then the RPE.", button "Stop and use this".
2. **HEARD THIS** (grey) — the transcript verbatim, then three chips (weight, reps, RPE) from the parse; empty slots show a dash. Tapping a chip opens the existing keypad on that field. Hint "Tap a value to correct it before logging." Buttons Discard and "Log set 3" (disabled until weight and reps are set).
3. **LOGGED** (green) — hint "Set 3 saved." or, offline, "Set 3 saved on this device. It will sync when you're back online." Button "Back to session".

"Log set N" calls the controller's `logSet`, so outbox, PR detection and rest start behave exactly as manual entry. The mic sits on the current set row (44pt target, artboard `session`) and as "🎙 Voice" on the console.

## 8. iPad console

### 8.1 Layout (artboard `ipad_console`)

- **Rail, 250pt** — header "Today · N"; **Live**: the PT's in-progress sessions (initials disc, name, program day, elapsed, running rest countdown), ember bar on the one shown; **This week** (D9) with Start through the existing `StartSessionSheet`; **All clients** search row; footer "Live mirror on · N devices" from Presence (D10). Tapping a live row swaps session in place with `router.setParams`, never `push`.
- **Middle, flex** — header: client name, program · week · day, session clock, End session. `SessionPlanPane`: exercises with done counts ("2/4"), the current one highlighted; tapping one makes it current.
- **Right, 320pt fixed** — `SetEntryPane` in console mode: "Now logging · set 3 of 4", exercise, large weight × reps, "Last: 95kg × 8 · RPE 7", ± steppers (weight 2.5 kg / 5 lb, reps 1), RPE chips 6–10, rest strip when running, **Log this set** 60pt pinned at the bottom, then 🎙 Voice and Skip set. All targets ≥ 44pt.
- RTL: the layout uses `start`/`end`, so in Arabic the rail is on the right and the logging panel on the left.

### 8.2 Switcher on the phone

A switcher chip in the session header, shown only when the PT has more than one live session, opens a sheet with the rail's Live and This week sections.

### 8.3 Data — `lib/logging/usePtFloor.ts`

One load: the PT's in-progress sessions with client names and program days, plus active clients' active programs; This week computed with `weekCompletion` and a completed-sessions-today check. Refetch on focus (PITFALLS N12) and on channel events; only the newest load may set state (O1). Offline: the warmed cache under the M4b rules; This week hidden when uncached.

## 9. Failure behaviour

| Case | Behaviour |
|---|---|
| No recognizer, no offline model, or mic/speech permission denied | Mic shown disabled with the reason; permission denial offers Settings. Manual entry untouched. |
| Parse `none` or `partial` | HEARD THIS with the transcript and empty chips; the PT fills them by tap. No guess. |
| Notification or exact-alarm permission denied | In-app timer as today; one hint line on the timer screen; not re-asked in the same session. |
| Native module absent (web, Expo Go) | `RestActivity.isAvailable()` false; all calls no-op. |
| Native action for a finished or unknown session | Dropped by `applyNativeActions`. |
| App killed mid-rest | Store hydrates from `KvStore`; native notification still counting; queued taps applied on open. |
| Presence join refused | Rail shows "Live mirror on" without a count. |

## 10. Testing

1. **vitest** (`packages/shared`): voice parser and fixtures with the ≥ 95% assertion, both languages; rest rules (`soonest`, `plus30`, `togglePause`, `applyNativeActions` idempotency and ordering); This week rule.
2. **typecheck + lint** across the monorepo.
3. **RLS harness**: `0018` assertions (§4), run against the live project after the push.
4. **Screen walks** (`forge-screen-walk`, web): phone-width regression of the refactored session screen (M4a and M4b flows); console at ~1100px — switch clients, log a set, rest carried per client, start from This week, RTL; voice with Chrome's fake-audio flags feeding a WAV, or, if headless Web Speech will not run, a mocked recognizer result stream (recorded in As-built).
5. **Device** (EAS `development` Android APK): lock-screen countdown, +30s and Skip with the app swiped away, alarm sound at zero, reconcile on reopen, English and Arabic voice on a real mic. A runbook checklist lives in the plan.
6. **iOS**: EAS `development-simulator` build compiles the Live Activity target.

## 11. Out of scope

Claude fallback for unparsed speech. Voice exercise switching. Bookings in the rail (M5). Apple Watch. Coaching voice cues. A client-side console. Re-evaluating PRs on edit (M4a limitation). iOS device verification (needs an Apple developer account).

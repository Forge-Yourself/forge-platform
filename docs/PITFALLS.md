# Pitfalls

Traps this codebase has already fallen into, each with the rule that prevents a
repeat. Every entry names where it actually bit, so the rule stays arguable
rather than becoming folklore.

Add to this file whenever a bug turns out to be an *instance of a class* rather
than a one-off. A bug that can only happen once belongs in the commit message.

---

## Navigation

### N1. Every stack sets `headerShown: false` — the screen owns its own back control

`(app)/_layout.tsx`, `(auth)/_layout.tsx` and `(onboarding)/_layout.tsx` all set
`headerShown: false`. There is no framework-supplied back button anywhere in
this app. A pushed screen that draws no `NavHeader` and offers no explicit exit
is a dead end, and nothing in review flags it.

**Rule:** any screen reachable by `router.push` renders a `NavHeader` with a
leading back/cancel control, or an equally explicit exit in its footer.

**Seen in:** the intake wizard and the waiver screen both shipped with no way
out. A client who opened the waiver from Today was stuck there.

### N2. An escape affordance in the scroll body is not an escape affordance

The intake wizard *did* have "Save & exit" — at the bottom of the scrolling
form, below the fold. On step 1 the client saw a PAR-Q and a Continue button
and nothing else.

**Rule:** back, cancel, skip and save-and-exit live in `NavHeader` or the sticky
footer. `FormScreen` has a `header` slot and a `footer` slot for exactly this;
neither scrolls.

### N3. `router.replace`, not `push`, after a state-changing submit

Hardware back and the iOS edge swipe both pop the stack whatever the UI shows.
Leaving a completed step on the stack means back can reopen it.

**Rule:** after a submit that changes server state, `replace` the current route.
`push` is for navigation the user can meaningfully undo.

**Seen in:** intake → waiver and waiver → done both used `push`, so back landed
on an already-submitted intake form (re-editable) and an already-signed waiver.

### N4. A terminal screen still needs a way onward

Success and confirmation screens are the one place a back control is wrong —
but they need an explicit "Back to home" instead. `intake/done.tsx` is the
reference.

### N5. The root gate is passive — a screen that changes gate state must navigate itself

`app/_layout.tsx`'s `Gate` ends in `return <Slot />`, and `<Slot />` renders
*whatever route already matched* — not a home screen. The gate only actively
redirects for a specific list of unmet conditions. Everything else falls
through and leaves the user exactly where they were.

So a screen that writes state the gate reads — `users.role`,
`users.onboarding_completed`, `pt_profiles` — needs **two** steps, not one:

1. `await refreshAuthProfile()`. A raw `supabase.from(...).update()` fires no
   Supabase auth event, so `useAuth().user` and the gate reading it stay stale.
2. `router.replace('/')`, handing control back to the gate — **unless** the gate
   has an *active* redirect that fires for the new state.

Which is which:

| State after the write | Gate | Screen must navigate? |
|---|---|---|
| `role='pt'`, `onboarding_completed=false` | active `<Redirect>` → `(onboarding)/pt-profile` | no |
| `role='pt'`, onboarding done, no `pt_profiles` row | active `<Redirect>` → `(onboarding)/pt-profile` | no |
| `role='client'`, `onboarding_completed=true` | falls through to `<Slot />` | **yes** |
| onboarding done, MFA enrolled from settings | falls through to `<Slot />` | **yes** |

**Rule:** after `refreshAuthProfile()`, either point at the gate branch that will
move the user, or `router.replace('/')` yourself. `pt-profile.tsx`'s
`handleFinish` and `mfa-enroll.tsx`'s `handleVerified` are the reference.

**Seen in:** `(onboarding)/role.tsx`'s client branch wrote
`onboarding_completed = true`, refreshed, and stopped. The DB row flipped —
confirmed by psql, `updated_at` moved and the flag went `f` → `t` — but the gate
fell through to `<Slot />`, which re-rendered the route that already matched: the
role picker itself. The report was "I click Continue and nothing happens". Every
client signup was a dead end.

**Corollary:** `(auth)/sign-in.tsx` deliberately navigates nowhere and relies on
the gate. That holds only while an active branch covers every
signed-in-but-incomplete state. Add a new one and sign-in becomes a dead end too.

### N6. A gate redirect that its own target must clear has to be guarded by `isCurrentRoute`

expo-router's `<Redirect>` drives `router.replace()` from a `useFocusEffect` whose
callback it does not memoize, so the deps change every render and the replace
re-runs for as long as the component stays mounted. `Gate` returns a redirect
*instead of* `<Slot />` — so a branch whose condition can only be cleared by
rendering the screen it redirects to never gets to render it: replace, re-render,
replace, forever. On web that reads as a page reloading in a loop; on native, a
screen that never paints; either can surface as `Maximum update depth exceeded`.

**Rule:** every branch in `Gate` yields via `isCurrentRoute(segments, group, route)`
when it is already on its own target. Keep the guard on any branch you add.

**Seen in:** the post-onboarding `pt_profiles` check. A PT with
`onboarding_completed = true` and no `pt_profiles` row — reachable by skipping every
step of the wizard — could not open the app at all.

### N7. `href: null` hides a tab button; it does not unregister the route

In expo-router 57, `build/layouts/TabsClient.js` maps `href` onto options only:
`tabBarItemStyle: { display: 'none' }` and `tabBarButton: () => null`. The screen
stays registered in the navigator and stays reachable by URL and deep link.

**Rule:** `href: null` is a UI affordance, not an authorization boundary. If a
route must be unreachable for a persona, gate it inside the screen or use
`<Tabs.Protected>`. RLS is what actually protects the data — keep it that way.

**Seen in:** `(app)/(tabs)/_layout.tsx` carried the comment "a client … cannot reach
the three PT routes, even by deep link (href: null removes them from the navigator
entirely)". That was true of an older expo-router, not this one.

### N8. Settings is the only door to sign-out and profile, and it is on Today by necessity

`(app)/settings` is reachable from exactly one control: the sliders `IconButton` in
the Today header (`SettingsButton` in `(app)/(tabs)/index.tsx`). Sign-out, language,
units, MFA enrol/unenrol, profile view/edit and consent withdrawal all live behind
it and nothing else links there.

It is on Today rather than in the tab bar because a client renders **no tab bar at
all** — `(tabs)/_layout.tsx` passes `tabBar={() => null}` for clients — so a fifth
tab would strand every client persona. Today is the one screen both personas land on.

**Rule:** don't relocate or gate that button without giving clients another route in.
Adding a second entry point is fine; removing the only one is not.

### N9. Pushing a tab route from a stack screen mounts a *second* tab navigator

`(tabs)` is one screen of the `(app)` stack. From a sibling stack screen,
`router.push('/(app)/(tabs)/library')` diverges at the `(app)` stack
(`expo-router/build/global-state/getNavigationAction.js` → `findDivergentState`), so
the action stays a `PUSH` and pushes the whole `(tabs)` route again — a second tab
navigator mounts on top of the screen you came from. What you land on is a **tab
root**, which by N1 draws no back control. There is no way back, and the screen
underneath keeps its unsaved state where nobody can reach it.

From *inside* the tab navigator the same call is fine: divergence happens at the tab
navigator instead, the action becomes `JUMP_TO`/`NAVIGATE`, and it switches tabs.
That is why `(tabs)/index.tsx`'s link to the Library tab is correct.

**Rule:** a tab route is a destination for tab *switching* only. A stack screen that
needs a list to pick from gets its own pushed route with its own `NavHeader` Cancel.
Share the body as a component so the two entry points cannot drift.

**Seen in:** the program builder's "+ Add exercise" routed to `(app)/(tabs)/library`.
Choosing an exercise popped the detail screen and left the PT stranded on the library
list with the unsaved program buried two frames below. Fixed by
`(app)/programs/[id]/pick-exercise.tsx`, which renders the shared
`lib/exercises/ExerciseLibrary` and returns with `router.dismissTo` — `POP_TO` matches
by route name and keeps the builder's route key, so its draft survives the round trip.


### N10. A value set just before navigating must not be cleared by the effect that reads it

`useFocusEffect(useCallback(fn, [x]))` does not only run on the way back. `x` is a
dep, so setting `x` re-runs the effect **immediately, while the screen is still
focused**, before the queued navigation has committed.

**Rule:** an effect consuming a cross-screen handoff must bail *before* touching the
slot unless the handoff is actually present. Clear-on-every-run is what breaks —
arming the slot instantly disarms it.

**Seen in:** the builder's exercise pick-up. `setPendingBlockIndex(blockIndex)`
re-ran its own focus effect, which cleared `pendingBlockIndex` "in case the picker was
cancelled" — so every chosen exercise came back to a null slot and was silently
dropped. The cancel case that guard existed for was unreachable anyway: the slot is
re-armed before every push, and only the picker's detail screen can produce a pick.

### N11. A gate carve-out must name exact routes, never a whole group

N6 says a gate branch has to yield when it is already on its own target. The
mirror of that: a branch must **not** yield for any other route, because the
carve-out and the redirect then take turns.

`Gate` returns a redirect *instead of* `<Slot />`, so rendering one unmounts the
root navigator. A navigator that remounts comes up on its default route —
`(app)/(tabs)` — one commit before the URL is applied, and any navigation issued
while it was unmounted is dropped. So with a group-wide carve-out the cycle is:

```
segments = (auth)/sign-in   -> carve-out returns <Slot/>      -> navigator mounts
segments = (app)/(tabs)     -> branch returns <Redirect .../> -> navigator unmounts
segments = (auth)/sign-in   -> carve-out returns <Slot/>      -> ...
```

The `<Redirect>`'s own effect never gets to run before it is unmounted, so the
`replace` never happens and the URL never moves off `/sign-in`. React gives up
with `Maximum update depth exceeded` inside `<BottomTabNavigator>`, and the app
shows a blank screen.

**Rule:** carve-outs are `isCurrentRoute(segments, group, route)` per route, the
same call N6 uses. `segments[0] === '(group)'` is only safe in a branch whose
redirect target is itself inside that group — as in the `signedOut` branch, which
sends you to `(auth)/sign-in`. Ask of every carve-out: if the navigator remounts
on `(app)/(tabs)` right now, does this branch flip? If yes, it oscillates.

**Seen in:** the `onboarding_completed === false` branch carved out all of
`(auth)`. Sign-in does not navigate on success (N5 — it lets the gate route
onward), so a user signing in with onboarding still to do was signedIn while
parked on `(auth)/sign-in`, and hung there. It reproduced for every such account,
PT or client. Now carved out per route: `(auth)/verify-success`,
`(auth)/reset-password`, `(onboarding)/mfa-enroll`.

**Reproducing a gate loop at all** is the hard part, because nothing in
typecheck, lint or the test suite can see it. What worked: drive the web build in
headless Chrome over CDP, sign in through the real form, and log
`{status, role, onboarding_completed, aal, segments}` from an effect in `Gate`
with **no dependency array** — one line per commit. Counting in the render body
trips `react-hooks/immutability` and double-counts under StrictMode. The
oscillation is obvious the moment the commits are in order; reasoning about the
branch table is not enough, and two plausible root causes were wrong before the
log settled it.

---

### N12. A tab list stays mounted under a pushed screen, so a mount effect never re-runs

A tab screen is not unmounted when a stack screen is pushed over it, and
`router.back()` returns to the same instance. A list hook that fetches in a plain
`useEffect(..., [])` therefore runs exactly once per app session: rename a program
in the builder, assign it, instantiate a template, come back, and the Programs tab
still shows the old rows until pull-to-refresh. The Today tab had the same hook and
the same staleness.

**Rule:** a list a pushed screen can mutate must refetch on focus (`useFocusEffect`
from `expo-router`) or subscribe to an explicit change signal. Pick by cost of
refetching: `useProgramList` refetches on focus because it has no pagination to
lose; the exercise library uses a counter (`customExerciseSignal.ts`) because a
focus refetch would reset "load more". Do not fix this per screen with a
`refetch()` before `router.back()` — that covers one caller and misses the rest.

### N13. A screen with two entry points must work from both

`programs/ai` was written for the builder, which always passes `clientId`. Then
Today grew a "Draft with AI" tile that pushed the same route with no params. The
screen rendered, the intro read "...before anything reaches ." (empty
interpolation), and Generate could only fail with "You're not this client's
trainer." Reviewers read the screen in isolation and passed it.

**Rule:** before wiring a new caller to an existing route, grep every
`pathname: '/(app)/<route>'` and read what each caller passes. A param the screen
cannot work without is either supplied by every caller or chosen on the screen
(the AI screen now shows a client chip row when it arrives without one). Never
let a missing param surface as an unrelated error.

### N14. If the copy says "do X first", X is tappable on that screen

The builder footer said "Assign this program to a client first" next to a
disabled button, and no screen in the app offered Assign for a non-template
program (the only Assign lived on the Programs tab's *template* cards). The
route existed, was typed, and was unreachable for the state that needed it.

**Rule:** an instruction in UI copy is a promise of an affordance on the same
screen. When a button is disabled for a fixable reason, replace it with the
button that fixes it (builder: Assign when `client_id` is null, Draft with AI
otherwise). When adding a route, grep its callers and ask which states can
reach it. A route with one caller guarding one variant is usually an orphan for
the others.

### N15. `router.back()` is not an escape control on a cold deep link

On web, a screen opened directly (`/forgot-password` in a fresh tab, or any
email link) has no stack beneath it. `router.canGoBack()` reported true and
`GO_BACK` was then dropped as "not handled by any navigator", so the Back
button did nothing. Device users hit the same thing from `forge://` links.

**Rule:** a Back/Cancel control whose parent is known uses
`router.dismissTo('/(auth)/sign-in')` (pops to it when present, replaces when
not). Bare `router.back()` is only for controls with no fixed parent. Test every
auth and invite screen by loading its URL directly.

## Forms and input

### F1. Never a bare `TextField` for a date

A `placeholder="YYYY-MM-DD"` asks a client on a phone to hand-type a format and
says nothing when they get it wrong.

**Rule:** calendar dates use `ui/DateField`, with `minDate`/`maxDate`. The
schema backing them uses a refined calendar-date check, never bare `z.string()`.

**Seen in:** `target_date` and `date_of_birth`. `2026-13-40`, `14/09/2026` and
`next June` all reached the database as strings — and a malformed
`date_of_birth` then made `intakeSummary()` show the PT **no age at all**,
silently. Bad input that degrades into a blank is worse than bad input that
errors.

### F2. One source for a numeric bound, and never silently drop a value

`parseDecimal()` carried its own copy of the height/weight bounds, separate from
the zod schema's, and returned `undefined` for anything it disliked. Typing
`1750` for height kept the digits on screen, showed no error, and recorded
nothing.

**Rule:** bounds live in one exported constant (`INTAKE_LIMITS`) that the zod
schema, the parse function and the inline error message all read. A rejected
value gets a visible message — never a silent `undefined`.

### F3. Optional is not the same as unvalidated

Everything on the intake except PAR-Q is optional, so empty must never be an
error. But "filled in wrongly" must always be one.

**Rule:** validators return `null` for empty *and* for valid, and a problem code
otherwise. See `checkNumericField` / `checkCalendarDate`.

### F4. Zero and false are answers

`0` years of training is a beginner. `false` on a PAR-Q question is the answer
that matters most.

**Rule:** never use truthiness to decide whether a field was answered. Only
`undefined`/`null`, the empty/whitespace string and the empty array are absences.

---

## Derived state

### D1. Key presence is not an answer

The intake screen seeds its state from `emptyResponses()`, which sets every
section to `{}` so the typed shape is whole. Any completeness check written as
`responses[section] !== undefined` is therefore **always true**, from the first
render, before the client has typed anything.

**Rule:** completeness checks inspect content, not keys.

**Seen in:** `intakeCompletion()`. A client who saved and exited at step 1 came
back to five green ticks on a form they had not filled in — and
`goToFirstIncompleteStep()`, finding no incomplete step, dropped them on step 5
with the PAR-Q never asked. The same rule was wrong the same way in SQL; see R1.

### D2. A state flag is not evidence of content

`saveProgress()` flips the row to `in_progress` on the first Save & exit whether
or not anything was entered, so `state === 'in_progress'` alone was showing
"Welcome back / what you've saved so far" over an empty checklist.

**Rule:** gate "resume" UI on there being something to resume, not on the state
column.

---

## Rules that live in two languages

### R1. A rule expressed in both TypeScript and SQL needs tests on both sides

`intakeCompletion()` (TS) and `intake_progress()` (SQL) implement the same
"how much of the intake is answered" rule for the client and the PT
respectively. Both were wrong, independently, and only the TS one had tests.

**Rule:** when a rule is duplicated across the app and the database, write the
same case table against both. The SQL side can be exercised directly with
`psql -c`, which is how R2 was caught.

**Seen in:** the client saw five false ticks (D1); the PT's client detail
separately read "5/5 sections answered" for a client who had answered none,
because `intake_progress()` counted `jsonb_object_keys(responses)`.

### R2. `bool_and` ignores NULLs

```sql
-- WRONG: an unanswered id is NULL, bool_and skips it, one answer satisfies all seven
SELECT coalesce(bool_and(jsonb_typeof(responses->'parq' -> q) = 'boolean'), FALSE) ...

-- RIGHT: collapse NULL to FALSE *inside* the aggregate, where bool_and can see it
SELECT coalesce(bool_and(
  coalesce(jsonb_typeof(responses->'parq' -> q) = 'boolean', FALSE)
), FALSE) ...
```

An outer `coalesce` does not help — it only guards the empty-input case, which
never happens here.

**Rule:** any `bool_and`/`bool_or` over a lookup that can miss needs the
`coalesce` inside the aggregate. The JS twin is not a safety net: `every` over a
missing key is plainly false, so the two languages disagree by default.

**Seen in:** migration `0011`, fixed by `0012`. A PAR-Q with one of seven
questions answered counted as a complete safety screen.

---

## The web target

### W1. A bug that only exists on web is invisible on device

On iOS and Android `fetch` has no same-origin policy. Under
`expo start --web` the same code runs in a browser and everything about
cross-origin applies. Anything that works on a simulator can still be broken in
the browser, and vice versa.

**Rule:** anything touching `WEB_HOST` gets tested on `--web` as well as native.

### W2. Every `/api/*` route the app calls needs CORS, and it belongs in middleware

Every mobile→web call sends an `Authorization` header, which makes it a
non-simple request, so the browser preflights with `OPTIONS`. Next answers a
preflight to a route with no `OPTIONS` export with **405**, and the app sees an
opaque "CORS error" with no status — which the UI then renders as its generic
"something went wrong".

**Rule:** CORS is handled once in `apps/web/middleware.ts`, not per route. The
AI broker alone has a dozen early `Response.json(..., { status })` returns and
every one of them needs the headers.

**Seen in:** `POST /api/waiver`. The client's signature never left the device.

### W3. Never set `Access-Control-Allow-Credentials` on these routes

`/api/waiver`, `/api/waiver/[intakeId]` and `/api/ai/program-draft` all
authenticate from a Bearer token in a header, never a cookie. Setting
`Allow-Credentials` alongside an echoed origin would let a third-party page
drive the cookie-authenticated `/admin` surface using the user's own session.

**Rule:** no credentials. Without it the browser sends no cookies cross-origin
at all, and a caller must already hold a token — which a hostile page cannot
obtain from here. `ALLOWED_ORIGINS` (comma-separated) replaces the default
localhost-only allowlist in production.

### W4. A native-only API called unconditionally errors on web

`BackHandler` logs `BackHandler is not supported on web and should not be used` on
every registration under `expo start --web`, and it is not alone — anything backed by
a native module (haptics, the `Animated` native driver, camera) warns or degrades.

**Rule:** guard native-only APIs with `Platform.OS` and say in the comment what the
web equivalent is, or why there is none. Browser back goes through history; a
`BackHandler` could never have intercepted it.

**Seen in:** `(app)/programs/[id]/builder.tsx`'s unsaved-changes guard, which logged
the error twice per visit because its effect re-runs on `dirty`.

### W5. react-native-web forwards RN props it does not recognise straight to the DOM

`accessible={false}` reaches the DOM verbatim and React logs ``Received `false` for a
non-boolean attribute `accessible` `` on **every render** — at error level, loud
enough to bury real errors in the console you are debugging in.

**Rule:** prefer the cross-platform ARIA spelling (`aria-hidden`) for decorative
nodes, and the style spellings (`style.pointerEvents`, `boxShadow`) over their
deprecated prop forms. Note `accessible={false}` on a plain `View` was a no-op on
native to begin with — a `View` is not an accessibility element unless `accessible`
is true — so deleting it changes nothing there.

**Seen in:** `ui/Avatar.tsx` and `ui/BuilderBlock.tsx` (deleted) and `ui/Icon.tsx`
(→ `aria-hidden`); `library/[id].tsx`'s `pointerEvents="none"` → `style.pointerEvents`.
The `shadow*` → `boxShadow` deprecation in the theme's elevation tokens is still open.

### W6. NetInfo on web does not hear the browser go offline

`@react-native-community/netinfo`'s web module listens to `navigator.connection`'s
`change` event whenever that API exists (Chrome, Edge), and in that case never to the
window `online` / `offline` events. A browser dropping its connection may never reach
a NetInfo listener, so an offline-aware screen keeps behaving as if online.

**Rule:** on web, also listen to window `online` / `offline` and read `navigator.onLine`,
and seed the initial state from it rather than assuming online.

**Seen in:** `lib/offline/OfflineProvider.tsx` (M4b). The initial `useState(true)` also
sent a cold offline boot's first reads to the network, where they queued behind
supabase-js's own auth retries for ~20 s before the cache answered.

---

## Offline and sync

### O1. Overlapping loads land out of order, and a stale one wins

A screen reloads on focus, after its own write, and on a broadcast. Each load is a
chain of round trips, so a read that *started* before a write landed can *finish*
after a newer one, and the last `setState` wins. With an outbox the window is wider:
the Finish replays, `prune` drops the local copy, and a server read taken a moment
earlier returns `in_progress` with nothing local left to outvote it.

**Rules:** only the newest load may land (a sequence ref); read the local row
*before* the server; and make state that only moves forward monotonic at the store
(`applyServerSession` never regresses `completed` to `in_progress`).

**Seen in:** `lib/logging/useSession.ts` (M4b). The PT pressed Finish, the server
completed the session, the client's screen showed the summary, and the PT's own
screen went back to logging. Caught by the M4b screen walk, not by review.

### O2. A browser offline simulation that leaves the socket up lies

Blocking Supabase HTTP in a test (Playwright `route().abort()`) does not close an
open Realtime websocket, so a "offline" device still receives broadcasts, and a
feature that depends on the socket looks fine. On a real device the socket dies
with the signal.

**Rule:** anything subscribed to Realtime keys its join off the app's `online`
state, so going offline (simulated or real) leaves the channel. `useSessionChannel`
does. `walk-m4b.mjs` in the `forge-screen-walk` skill shows the simulation recipe.

---

## i18n

### I1. `en.json` and `ar.json` must match in keys *and order*

`i18n.test.ts` asserts both. Appending a key to the end of one file fails the
order assertion even when every key is present.

**Rule:** insert a new key at the same position in both files. Both round-trip
exactly through `JSON.stringify(json, null, 2) + '\n'`, so a script that parses,
splices and re-serialises both is safe.

### I2. Design-system components take label props, they do not call `t()`

`SignaturePad` takes `clearLabel`, `YesNoCard` takes `yesLabel`/`noLabel`,
`DateField` takes a `labels` object. Keeps `ui/` free of an i18n dependency and
keeps every string greppable from the screen that uses it.

---

### I3. A `{{name}}` interpolation needs a no-name variant

`ai.intro` ends "...before anything reaches {{name}}." Rendered with `name: ''`
it produced "reaches ." Typecheck, lint and the key-parity test all accepted it,
because the string and the call were each valid on their own.

**Rule:** for every `t(key, { name })` where `name` can be empty, branch to a
second key (`ai.introNoClient`) instead of passing `''`. When adding keys, insert
them at the same position in `ar.json` as in `en.json`. The parity test checks
order, so appending to one file and prepending to the other fails.

## Project configuration

### P1. Supabase project settings change the shape of what the SDK returns

`supabase.auth.signUp()` returns a session when the project has email
confirmation off, and `session: null` when it has it on. The sign-up screen used
to push to `(auth)/verify-pending` unconditionally, which is right for exactly
one of those two settings — with confirmation off it strands a signed-in user on
a "check your inbox" screen waiting for mail nobody sent, and the root gate will
not rescue them, because its signed-in branch renders any `(auth)` route as-is
(see N5).

**Rule:** branch on what the call returned (`if (data.session)`), never on what
you believe the project is configured to do. Project config is not in the repo,
is changed from a dashboard by a human, and differs between environments.

### P2. A failed outbound email fails the entire signup

With confirmation on, GoTrue treats "could not send the confirmation email" as
fatal: `POST /auth/v1/signup` returns `500 unexpected_failure`, the `auth.users`
row is rolled back, and nothing is left behind to show what happened. So a
sender-domain problem in Resend — DNS, a key, an unverified domain — presents as
*signup is completely broken*, with no failure visible on the auth side at all.

That is what happened on 2026-09-15: the configured sender was
`noreply@forge.app`, `forge.app` was never verified in Resend, and every send
came back `403 The forge.app domain is not verified`.

**Rule:** when signup fails with `unexpected_failure`, test the mail path
directly before reading a line of app code. One curl settles it:

```bash
set -a && . ./.env && set +a
curl -s -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" -H "Content-Type: application/json" \
  -d '{"from":"Forge <noreply@forge.app>","to":["delivered@resend.dev"],"subject":"probe","text":"probe"}'
```

A send-only Resend key returns 401 on `/domains` and `/api-keys` by design —
that is not the fault, keep going and test `/emails`.

**Corollary:** never let an infrastructure failure render as
`auth.errors.generic`. "Something went wrong. Please try again." is advice that
cannot work for a fault no retry fixes. `mapAuthError` now recognises the mail
failure specifically.

---

## Security boundaries

### S1. A row policy on a table with default grants is a mass-assignment hole

Supabase grants `ALL` on every `public` table to `authenticated`. An RLS policy
then decides *which rows* a caller may write — it says nothing about *which
columns*. `clients_insert` checked `pt_user_id = auth.uid()` and let the caller
pick `client_user_id` and `state` freely, so any account could fabricate a
trainer relationship with any UUID, and every `is_pt_of_*` predicate believed it.

**Rule:** a table whose rows carry authorization-bearing columns (`client_user_id`,
`role`, `state`, anything a `SECURITY DEFINER` predicate reads) is written only
through RPCs. `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated` and drop the
write policies, the way `0003` did for `users.role` and `0014` did for `clients`.
If a column genuinely needs direct editing, re-grant that one column.

**Seen in:** `clients` (`0003`/`0005`, closed by `0014`). The harness had tested
the client-tamper direction only; the PT-forges-a-client direction had no case.

### S2. `email_confirmed_at` is only proof of ownership while confirmations are on

With `[auth.email] enable_confirmations = false`, GoTrue stamps
`email_confirmed_at` at signup for whatever address was typed. A function that
gates on it — `claim_client_invites()` — degrades to "anyone who knows the
invitee's address".

**Rule:** treat `email_confirmed_at` as necessary, not sufficient. Also require
`confirmation_sent_at IS NOT NULL` (the flow ran), `invited_at IS NOT NULL`, or an
`auth.identities` row from a verifying provider. Test accounts created by SQL
need `confirmation_sent_at` set or they will claim nothing.

### S3. An RPC granted to `authenticated` is a public API, whatever the comment says

`refund_ai_credit()` was documented as "an operator tool for support cases" and
never called from the app — but it was `GRANT EXECUTE ... TO authenticated` with
an owner-passes guard, so a PT could refund every generation they paid for and
still turn it into a program.

**Rule:** if only an admin or the server should call it, the guard is
`IF NOT public.is_admin() THEN RAISE`, and the server calls it with the service
role. Grep `apps/` for the RPC name before trusting a "nothing calls this" note.

### S4. `**` in a Supabase redirect allow-list crosses `/` and `.`

`additional_redirect_urls = ["exp://**"]` allowed any host. Combined with the
implicit OAuth flow (which GoTrue selects whenever the caller omits
`code_challenge`, regardless of the app's `flowType`), that redirects a victim's
tokens to an attacker's Expo project.

**Rule:** exact URLs only. A dev-time wildcard goes in the dashboard for the
session, never in `config.toml`, which is pushed to production.

---

## Verifying against the live DB

There is no local Postgres. The fastest way to prove whether a write actually
landed — rather than reasoning about RLS from the migrations — is to query the
live project directly.

```bash
set -a && . ./.env && set +a
PGPASSWORD="$SUPABASE_DB_PASSWORD" "/c/Program Files/PostgreSQL/18/bin/psql" \
  "$(cat supabase/.temp/pooler-url)?connect_timeout=15&sslmode=require" -w \
  -c "select email, role, onboarding_completed, updated_at from public.users;"
```

Three details that each cost time:

- **`supabase/.temp/pooler-url` holds no password.** Passing it to `psql` as-is
  makes psql sit at an interactive password prompt forever, with no output and no
  error. `PGPASSWORD` plus `-w` (never prompt) is what makes it non-interactive.
- **`?connect_timeout=15&sslmode=require`** so a bad connection fails fast rather
  than hanging.
- **`supabase db push` reporting "Remote database is up to date" only means the
  history table agrees.** Confirm the SQL actually took effect — `to_regprocedure`
  for a new function, `pg_get_functiondef` for a changed body — before believing a
  migration is live.

This is what separated "the button handler never ran" from "the handler ran, the
DB changed, the UI didn't move" in N5. It is also how R2's `bool_and` bug was
caught: `psql -c "SELECT public.intake_answered_sections(…)"` against a handful of
hand-written JSONB payloads, before any client ever saw the wrong number.

After any migration that touches RLS policies, run the harness and expect every
assertion to pass — 97 of them as of migration 0014:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
```

---

## Verifying in the browser

### V1. A static review is not a test

Four parallel code reviewers, typecheck, lint and 238 unit tests passed the
tree that had N13, N14 and N15 in it. All three were found in under ten minutes
by signing in to the Expo web build in headless Chrome and tapping through.

**Rule:** "tested" means the flow ran. Before claiming a screen or flow works,
run the walk in `.claude/skills/forge-screen-walk/` (Expo web under Node 24,
`playwright-core` + system Chrome, the `@forge.dev` test accounts) and read the
screenshots. Load every auth/invite screen by direct URL as well as via its
in-app entry point (N15).

### V2. Metro on this machine serves stale route bundles after edits

`expo start --web` kept serving the pre-edit lazy route bundle after a save, so
a fix "did nothing" in the browser while the source was right. Kill the process
on 8081 and restart with `--clear` after each batch of edits. Expo web also needs
Node 22+ (`Node.js detected but native WebSocket not found`, thrown from
`lib/supabase.ts`); put the nvm `v24.15.0` directory first on PATH as a POSIX
path. A backslash `$APPDATA` path is silently ignored by bash.

## Design

### D1. The prototype is the spec wherever it is explicit

`docs/Forge_Prototype.html` is not a mood board. Each of its 33 artboards sets
literal type sizes, weights, tracking, spacing and element order, and the
sidebar script carries the designer's own annotations explaining intent
("Only one accent button per section", "step count is the honest signal of
remaining work").

Where it bit: the M3 design pass restyled sign-in from memory. The artboard
makes `FORGE` the screen's heading — 900/34/letter-spacing-7 — with "Welcome
back." as a 15px secondary subtitle under it. The rewrite put an invented
logo-tile lockup there and left "Welcome back." at `h1`, so the subtitle became
the heading and the brand became decoration. Sign-up gained a wordmark the
artboard does not have. The code that was replaced had been closer to the design
than its replacement.

**Rule:** extract the artboard and diff the numbers before restyling a screen
the prototype covers. Improvise only where it is silent — an empty state it
never drew, a dashboard it never specified, a component the DS lacks. Where a
shipped feature has no slot (Google sign-in postdates the prototype), keep the
feature and say in the PR that the treatment is yours. Where the
`docs/superpowers/plans/*.md` "Corrections" section disagrees with the
prototype, the plan wins.

### D2. Extracting an artboard

The file looks like an opaque 690KB blob; it is a bundle. Line 380 is a JSON map
of gzip+base64 assets, line 392 is the page HTML as a JSON string:

```js
const lines = fs.readFileSync('docs/Forge_Prototype.html', 'utf8').split('\n');
fs.writeFileSync('proto.html', JSON.parse(lines[391]));
```

Screens are `<sc-if value="{{ is_<screen> }}">` blocks — `is_signin`,
`is_clients`, `is_builder`, `is_ai` and so on. They nest, so slice on the
matching `</sc-if>` by counting depth. The trailing `<script type="text/x-dc">`
holds `GROUPS`, the annotated index of all 33.

### D3. Green checks do not mean the screen renders

Typecheck, lint and the full test suite all passed while every status chip,
tinted banner and initials disc was invisible in dark mode: `successSurface`,
`warnSurface` and `dangerSurface` were set to charcoal-700 — the same value as
`surfaceRaised` — so each was a zero-contrast rectangle on any card. Nothing in
the toolchain can see that.

**Rule:** look at a design change before calling it done. `npx expo export
--platform web` proves the bundle builds and produces something a headless
browser can screenshot; the gate only renders signed-out routes, so to see a
signed-in component put a throwaway screen under `src/app/(auth)/` with mock
data and delete it after. Note that Chrome will not lay out narrower than ~500px
on Windows, and `useColorScheme()` returns null on web so the theme falls
through to dark — light mode is not reachable this way.

`packages/shared/src/theme/tokens.test.ts` now asserts that a tint is visible as
a shape (per-channel delta, not a contrast ratio — these fills are deliberately
near-isoluminant and carry their signal in hue), so that specific class of bug
is a failing test now rather than a screenshot away.

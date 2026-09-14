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

---

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

## Open — unresolved

### O1. `Maximum update depth exceeded` signing in as a client

**Status:** unresolved, mechanism unproven. Reported 2026-09-13 on web.

```
[Error: Maximum update depth exceeded...]
  TabsLayout ((app)/(tabs)/_layout.tsx:38)
  AppLayout  ((app)/_layout.tsx:4)
  Gate       (_layout.tsx:162)     <- the <Slot/> in the onboarding_completed === false branch
```

What is known: it needs a signed-in user with `onboarding_completed = false`; the
stack frame is the `(auth)` carve-out inside that branch; the tabs tree was
rendering while `segments[0]` was still `'(auth)'`. It may have been N5's stuck
state surfacing as an N6 redirect loop rather than a separate defect — after N5
was fixed the reproducing account was no longer in the triggering state.

To reproduce, an account needs `role='client'` **and**
`onboarding_completed=false`. Then check whether `segments` oscillates or
freezes: those point at different fixes.

The instrumentation for that is already in the tree, marked `TEMP DEBUG`, in
`_layout.tsx` (`[gate]`) and `(app)/(tabs)/_layout.tsx` (`[tabs]`). Both counters
live in an effect with **no dependency array**, deliberately: counting in the
render body trips `react-hooks/immutability` (which fails CI) and double-counts
under StrictMode, which is the opposite of what a loop counter needs. Remove both
once this section closes.

A network trace on 2026-09-14 showed roughly a dozen repeated
`intake_forms?id=eq…` fetches in one session, which suggests something in this
family is still live.

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
assertion to pass — 85 of them as of migration 0012:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql" "$PGURL" -w -v ON_ERROR_STOP=1 -f db/rls_assertions.sql
```

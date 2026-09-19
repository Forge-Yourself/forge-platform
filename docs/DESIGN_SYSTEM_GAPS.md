# Design system gaps

Tracks components the prototype (`docs/Forge_Prototype.html`) calls for that
are not yet in `docs/Forge_DesignSystem.html`. Flagged in the prototype's own
embedded designer annotations. Update this list as components land or as
later milestones surface new gaps.

## Built (M1)

- **Password-strength meter** — three 4pt segments, semantic colors only
  (`successAccent` filled / `border` unfilled). Implemented at
  `apps/mobile/src/ui/PasswordStrength.tsx`, driven by
  `packages/shared`'s `passwordStrength()`. Not yet documented as a component
  in `Forge_DesignSystem.html`.
- **Numeric keypad** — 3-column grid, 56pt keys, built for reuse (M1 MFA
  challenge, M4 weight entry). Implemented at
  `apps/mobile/src/ui/NumericKeypad.tsx`. Not yet documented as a component
  in `Forge_DesignSystem.html`.

## Built (M2)

- **Segmented step-progress** — `StepProgress` gained an optional
  `segments?: number`; when given, renders that many separate 4pt bars
  instead of one continuous fill ("step count is the honest signal of
  remaining work", per the intake annotation). M1's continuous-bar callers
  (`pt-profile.tsx`) are unaffected. Implemented at
  `apps/mobile/src/ui/StepProgress.tsx`. Not yet documented as a component
  in `Forge_DesignSystem.html`.
- **Yes/no question card** — the PAR-Q question card: two 44pt Yes/No
  targets, an inline warn (not danger) flag treatment. Implemented at
  `apps/mobile/src/ui/YesNoCard.tsx`. Not yet documented in
  `Forge_DesignSystem.html`.
- **Signature pad** — 150pt `PanResponder`-driven SVG path capture, fully
  controlled, no native module. Implemented at
  `apps/mobile/src/ui/SignaturePad.tsx`. Not yet documented in
  `Forge_DesignSystem.html`.

## Built (M3)

- **Superset block header + 4-cell numeric builder row** — the block header
  carries a mono tag (A/B/C), a title and a rest chip; the row beneath it
  carries a slot badge (A1/A2), the exercise name, and a four-cell numeric
  strip. The arithmetic that makes it fit is written into the component's own
  header comment so nobody later folds the cells onto the name row:
  390 − 32 (screen gutter) − 24 (card padding) − 18 (three 6pt gaps)
  = 316 ÷ 4 = **79pt per cell at a 44pt height floor**. Implemented at
  `apps/mobile/src/ui/BuilderBlock.tsx` and
  `apps/mobile/src/ui/BuilderRow.tsx`. Omitting `onCellPress` renders the row
  read-only (plain Views, not inert Pressables) — that is the client's own
  view of their program, not a disabled state. Not yet documented as a
  component in `Forge_DesignSystem.html`.
- **Numeric keypad `extraKey`** — `NumericKeypad` gained an optional extra key
  filling its previously-empty bottom-left slot. The builder passes "." for
  the RPE cell (`target_rpe` is `NUMERIC(3,1)`, so 7.5 is a real value) and
  "-" for REPS, which is how a rep range is typed as "6-8". Existing MFA
  callers are unaffected. `apps/mobile/src/ui/NumericKeypad.tsx`.

## Built (M3 design pass)

A page-by-page reconciliation against `Forge_Prototype.html` found the same
chrome hand-rolled differently on every screen. These are the components that
absorbed it — all in `apps/mobile/src/ui`, none documented in
`Forge_DesignSystem.html` yet.

- **`Icon`** — the app's own SVG set on a 24 grid (`react-native-svg`, already a
  dependency). Replaces the text glyphs the app shipped with (`◆ ◎ ▦ ▤ ‹ › ⚙ ✦
  ⚡ ⧉ ℹ ⚠ ✕ ✓ ✉ ×`), which rendered at different weights and baselines per
  platform and had no Android system-font coverage for several. Directional
  glyphs mirror themselves under RTL.
- **`ScreenHeader`** — a tab screen's 27/800/−0.5 title plus its one action,
  held **outside** the list's ScrollView so the search box and filters stay put.
- **`NavHeader`** — `Cancel · Title · Save` chrome for pushed and modal screens,
  with fixed 72pt side slots so the title is optically centred. Every stack sets
  `headerShown: false`, so each screen previously drew this by hand.
- **`FooterBar`** — the pinned primary action with a top rule (Start session,
  Add to program, Generate draft). These used to sit at the end of the scroll
  body, below the fold on any long screen.
- **`SearchField`** — placeholder-first search box with a leading magnifier and
  a clear control. `TextField` was standing in, so every search box wore a
  floating uppercase form label ("SEARCH 205 EXERCISES").
- **`Tag`** — the status pill (`TODAY 9:00`, `PENDING`, `WEEK 3`, `MINE`,
  `UNSIGNED`), five tones off the contrast-verified surface/on-surface pairs.
- **`Avatar`** — initials disc with a deterministic tint from the name, so one
  person keeps the same colour in the roster, the program card and the header.
- **`StatTile`** — uppercase micro-label over a mono figure, three to a row.
- **`EmptyState`** — icon disc + title + body + action, covering the empty,
  no-match and offline-error states that were five ad-hoc stacks.
- **`SectionLabel`** — the 11/700/1.5 uppercase rule above a card group.
- **`WeekStrip`** — extracted from the Programs tab so it can live inside the
  card it describes rather than in a detached list below the roster.
- **`Divider`** — 1px rule, optionally broken by an `OR` cap.
- **`Wordmark`** — FORGE in three forms: `type` (letterspaced lettering only, what
  the sign-in artboard makes the screen's heading), `lockup` (mark tile +
  lettering, the brand doc's primary lockup) and `mark`.
- **`TextLink`** — "No account? **Sign up**": a line of muted copy with one ember
  tappable word. The auth footers used a full-width `Button` for this, which drew
  a control the size of a real action under a screen whose only real action is the
  ember CTA above it.
- **`IconButton`** — the round 44pt header control (the prototype's ember `+`).
- **`Button` gained** a borderless `link` variant for navigation and dismissal,
  `danger`/`accent` tones, a leading `icon`, a `loading` state, and a real
  disabled treatment (it previously rendered identically to enabled).
- **`ListRow` gained** `leading` (avatar/thumbnail) and an automatic `›`.

### Token fix this pass required

Dark mode set `successSurface`, `warnSurface` and `dangerSurface` to
charcoal-700 — the same value as `surfaceRaised`. Every status chip, tinted
banner and initials disc drawn on a card was therefore a zero-contrast
rectangle. They are now translucent tints of their own hue, and
`tokens.test.ts` asserts both that the on-tint text clears 4.5:1 over either
backdrop and that the fill is visible as a shape at all.

## Built (M3 follow-up)

- **`DateField`** — a calendar date chosen from a picker sheet rather than
  hand-typed. Month grid with prev/next, a year list behind the title
  (`startOnYear` opens straight to it, which is how a date of birth is
  actually reached), inclusive `minDate`/`maxDate` that grey out and disable
  days outside them, and Clear. Built from RN primitives, not a native picker
  module: the app targets web as well as iOS/Android and every other input here
  is hand-built. Month and weekday names come from `toLocaleDateString` with
  the app's active language, and the chevrons swap glyph under RTL because the
  row flips but the glyph does not.
- **`FormScreen` gained** a `header` slot rendered outside the ScrollView, so
  a screen's back control cannot scroll out of reach.

## Built (M4a)

- **Set stepper** — −5 / −1 / +1 / +5 keys, 56pt, unit-agnostic labels. `apps/mobile/src/ui/SetStepper.tsx`. Unused since the prototype `session` pass (the set row replaced the focus card); kept for the M4c ± measurement stepper. (M4a)
- **Logging set row** — prototype `session`'s "one logging-row component": set number, three mono cells (weight / reps / RPE), 44pt check; done / current / planned states. Local to `apps/mobile/src/app/(app)/sessions/[id]/index.tsx` as `SetRowView`. The artboard's mic button is voice logging, outstanding (M4d). (M4a)
- **Rest timer** — full-screen dark surface (prototype `timer`), 52px mono countdown, running / paused / complete, +30s and Skip rest. Presentational: `apps/mobile/src/ui/RestTimer.tsx`, clock in `apps/mobile/src/lib/logging/useRestTimer.ts`. Lock-screen variant outstanding (M4d). (M4a)
- **Rest strip** — the inline dark strip under the set rows (prototype `session`): 44pt ring, mono time, +30s, Skip; tapping it opens the full-screen timer. `apps/mobile/src/ui/RestStrip.tsx`, ring in `ProgressRing.tsx`. (M4a)
- **PR moment** — full-screen dark takeover (prototype `pr`), 56px mono record, previous best struck through with a delta pill. `apps/mobile/src/ui/PrMoment.tsx`. Replaces the M4a PR banner. The artboard's Share action waits for M9 comms. (M4a)

## Outstanding

No prototype-flagged gaps remain. Add new ones here as later milestones
surface them.

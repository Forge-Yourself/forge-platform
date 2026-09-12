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

## Outstanding

No prototype-flagged gaps remain. Add new ones here as later milestones
surface them.

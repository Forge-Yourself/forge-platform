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

## Outstanding

- **Superset / 4-cell builder row** — needed for M3 (program builder). Not
  yet built and not yet documented in the design system; should be designed
  and added to `Forge_DesignSystem.html` before M3 needs it.

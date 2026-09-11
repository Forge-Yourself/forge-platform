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

## Outstanding

- **Segmented step-progress** + **yes/no question card** — needed for M2
  (client intake / PAR-Q flow).
- **Signature pad** — needed for M2 (waiver e-signature).
- **Superset / 4-cell builder row** — needed for M3 (program builder).

These three are not yet built and are not yet documented in the design
system. They should be designed and added to `Forge_DesignSystem.html`
before the milestones that need them (M2 for the first two, M3 for the
third).

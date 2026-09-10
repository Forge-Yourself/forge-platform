# Forge — Design Brief for M1–M4

Input package for a design session. Covers only the screens the first four build milestones need. Everything later (billing, gyms, nutrition, reports) is deliberately excluded — those screens would be redesigned before they were ever built.

## What to hand over

1. `docs/Forge_DesignSystem.html` — the source of truth. Tokens, components, patterns, and ten existing mockups.
2. `docs/Forge_Brand.html` — voice, logo usage, color meaning.
3. This brief.

Do not restate the tokens by hand; the design system file already carries them and they are copied below only so the constraints read standalone.

## Non-negotiable constraints

**Target is React Native (Expo), not web.** Designs must map to `View`, `Text`, `Pressable`, `FlatList`, `Modal`. That rules out hover-dependent interactions, CSS grid layouts, and anything relying on a mouse. Every interactive element needs a touch target of at least 44×44pt.

**RTL from the start.** Arabic is a v1 language. Layouts must mirror cleanly — no hardcoded left/right, no directional iconography that breaks when flipped. Design at least the PT home and logging screens in both directions.

**Dark mode is not optional.** The design system defines both palettes. Gym floors are dark; PTs use the app one-handed under bad lighting.

**WCAG 2.2 AA.** Body text contrast ≥4.5:1. Every control needs a screen-reader label.

**Gym-floor ergonomics.** The logging screens are used standing, at arm's length, one-handed, often with a phone in a pocket between sets. Primary actions belong in the bottom third of the screen.

## Performance budgets that constrain the design

These come from the architecture doc's acceptance criteria and rule out certain designs outright:

| Interaction | Budget | Design consequence |
|---|---|---|
| Log one set | ≤2 taps, ≤800ms | No modal stack, no confirmation dialog, no navigation away |
| Switch between clients | ≤300ms | Switcher must be a persistent overlay, not a route change |
| Complete PT profile | ≤5 minutes | Progressive, skippable, not a wall of fields |
| Complete client intake | ≤10 minutes | Multi-step with visible progress, resumable mid-form |
| Client live mirror update | ≤3s | Needs a visible "live" indicator and a stale state |

## Already designed — use as the visual anchor

Ten mockups exist in the design system: sign in, onboarding, PT home/today, PT-led logging, client live mirror, program builder, schedule, money, progress, and Forge Shop. New screens must feel like siblings of these, not a new design language.

## Screens to design

### M1 · Auth & identity (EP-01, EP-02)
Existing: sign in, onboarding role chooser.

Needed: sign up; email verification pending and success; MFA enrollment (TOTP QR and SMS); MFA challenge at login; forgot password and reset; PT profile creation (bio, certifications, services — no rates field, Forge never handles session pricing); profile edit; account settings including language, units, and quiet hours.

### M2 · Clients & intake (EP-03)
Nothing exists yet. This whole flow is new.

Needed: PT client list (empty, populated, searching); invite a client (link and email); client detail overview; the intake form itself as a resumable multi-step flow covering PAR-Q, goals, training history, anthropometrics, and dietary restrictions; a save-and-resume state the client sees on returning; the PT's single-screen intake review with red-flag highlighting for PAR-Q answers that need attention; waiver e-signature capture; signed waiver confirmation.

### M3 · Programming (EP-04, EP-15)
Existing: one program builder mockup.

Needed: exercise library search with filters for muscle, equipment, and movement pattern; exercise detail with demo video and cues; custom exercise creation; program list and template list; the builder expanded — week navigation, day editing, block grouping, per-exercise sets/reps/RPE/tempo entry; copy-week action; assign program to client; the AI draft flow — prompt form (goal, equipment, experience level), generating state, and the editable result the PT must review before saving; AI credit balance display and the low-balance prompt.

### M4 · Logging (EP-05, EP-06)
Existing: PT-led logging (phone), client live mirror.

Needed: **iPad PT console — this is its own layout, not a stretched phone screen**; multi-client switcher overlay showing today's bookings first; rest timer in running, paused, and completed states, including how it appears when the screen is locked; voice logging — listening, recognized, and correction states; offline indicator plus a sync-pending queue view; conflict resolution when a client self-logged the same set; personal-record celebration moment; body metrics entry (weight, body fat, circumferences); progress photo capture with on-screen pose guides; photo side-by-side comparison across dates.

### Cross-cutting states
Every list needs an empty state, a loading skeleton, and an error state. The design system defines the patterns — apply them to the specific screens above rather than inventing new ones. Also needed: offline banner, permission prompts for camera, microphone, and notifications, and the destructive-action confirmation pattern.

## Deliverable format

Screen-by-screen layouts with the states named above, annotated with which design-system component each element uses. Where a screen has a tablet variant, show both. Flag any place the existing design system lacks a component you needed, so it can be added there rather than one-off.

## Explicitly out of scope for now

Billing and subscription screens (M6 — the payment provider changed to RevenueCat and the flow will follow store conventions), gym account screens (M7), Master and Sub-PT hierarchy views (M7), nutrition and meal planning (M8), reports and analytics (M9), messaging (M9), form-check video review (M10), and the Forge Shop (deferred to v3).

## Token reference

```
Brand:    charcoal-900 #0F131C · charcoal-800 #1A1F2B (primary surface) · charcoal-700 #222836
          iron-600 #3A4150 · iron-500 #4A5560 (body text) · iron-400 #6B7280 · iron-300 #9AA3B1
          iron-200 #CDD2DB · iron-100 #E5E8ED
          cream-100 #F5F2EE · cream-50 #FBFAF7 · white #FFFFFF
          ember-700 #B84812 · ember-600 #E8631A (primary action) · ember-500 #FF8A3D
          ember-300 #FFB068 · ember-100 #FCE7D3
Semantic: success #2E8B57 on #D5EBD9 · warn #C77800 on #FFF1D6 · danger #C0392B on #FADBD8
Spacing:  4px base — 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80
Radius:   sm 6 · md 10 · lg 14 · xl 20 · pill 999
Type:     sans -apple-system / Inter · mono JetBrains Mono (all numeric data uses mono)
Motion:   fast 80ms · default 150ms · slow 220ms · easing cubic-bezier(.2,.8,.2,1)
```

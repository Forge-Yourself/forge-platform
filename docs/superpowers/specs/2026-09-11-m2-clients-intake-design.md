# M2 · Clients & intake (EP-03) — Design Spec

**Status:** Approved 2026-09-11. Supersedes nothing; this is the first M2 doc.

## Problem

M1 shipped identity only. `clients`, `client_pt_assignments` and
`intake_forms` have existed in `db/schema.sql` since M0 and have RLS policies
since `0003_rls.sql`, but no application code has ever touched them. A PT
cannot add a client; there is no intake flow; the eight M2 screens in
`docs/Forge_Prototype.html` (`clients`, `invite`, `client_detail`, `intake`,
`intake_resume`, `intake_review`, `waiver`, `waiver_done`) are unbuilt.

## Outcome

A PT invites someone by email. That person signs up in the Expo app under
their own account, completes a resumable 5-step intake (PAR-Q, goals,
training history, anthropometrics, dietary restrictions) in ≤10 minutes
across more than one sitting, signs a liability waiver that becomes a
server-rendered PDF in Storage, and the PT reads the submitted intake on one
screen with red flags highlighted before session one.

## Decisions

1. **Client has an account; intake happens in the Expo app**, not on an
   anonymous web link. Consequence accepted: no store build exists until
   M10, so client-side testing in M2–M9 runs through Expo Go / internal
   builds only.
2. **Invite linking is by email match**, not a redeemable token.
   `clients.invite_email` holds the address; a client who signs up with a
   *verified* matching email gets linked automatically. Mitigation for the
   obvious failure (client signs up with a different address): the invite
   link pre-fills the address (`/join?email=…` → `forge://join?email=…`),
   and the PT can resend, revoke, or re-point an unclaimed invite. A client
   with no matching invite sees their own email with a copy action and a
   prompt to ask their trainer to invite that address.
3. **PT access = submitted intake + derived essentials only.** The PT reads
   the full intake once it is `completed` / `red_flag_review` /
   `waiver_signed`, and sees a summary card (age, sex, height, weight,
   primary goal, flag count) on client detail. The PT cannot read
   in-progress answers and cannot fill intake on the client's behalf in M2.
4. **Waiver PDF renders server-side** in a Next.js API route
   (`apps/web/app/api/waiver/*`) using `pdf-lib`, stored in a private
   Supabase Storage bucket (`waivers`) reachable only by the service role.
   Clients/PTs read it back through a signed-URL endpoint that authorizes
   via RLS first. This pulls Storage forward from M4 to M2.
5. **Client signs immediately after submit; PT review is async.** Deviates
   from architecture diagram D41, which routes a flagged intake through PT
   review *before* the waiver. D41's order would strand the client mid-flow
   with no way to notify them when the PT clears the flag (notifications are
   M9). Red-flag review gates *starting a session*, not signing the waiver.
6. **Client gets a minimal real home**: PT name/avatar, an intake status
   card (start / resume / done), and their signed waiver as a downloadable
   row. Logging, programs, and body metrics remain M3/M4.
7. **In scope beyond the 8 prototype screens:** full client list (5 states:
   loading, empty, populated, live search, no-match, offline error),
   pause/deactivate/reactivate, invite resend/revoke/re-point, and a
   read-only roster + intake view in the admin web.

## Two conflicts resolved

**`intake_forms_all` (0003_rls.sql:211) contradicts the design.** It is
`FOR ALL` and lets a PT read a row in any state, including `in_progress`.
The prototype's `intake_resume` screen promises the client the opposite:
"the PT can't see answers until you submit." Migration `0005` splits this
into a client-owner policy (all states) and a PT policy scoped to
`state IN ('completed', 'red_flag_review', 'waiver_signed')`.

**`clients` has no name column.** The prototype's invited-state list row
shows a name, but `clients` only has `invite_email`. `0005` adds
`invite_name VARCHAR(120)`.

## Data flow

```
PT invite_client(email, name, tags)
  → clients (state=invited) + intake_forms (state=pending) created together

Client signs up, role=client
  → claim_client_invites() on app boot: links every unclaimed,
    unexpired clients row whose invite_email matches the caller's
    verified email → client_user_id set, state=accepted

Client works through 5 intake steps
  → each step / "Save & exit" calls submit progress via direct
    RLS-scoped update (state: pending → in_progress)
  → PT can call intake_progress(client_id) for state + answered/total
    counts only — no response content

Client finishes step 5 → submit_intake(intake_id, responses)
  → server derives red_flags from the 7 PAR-Q answers
  → state → completed (no flags) or red_flag_review (any flag)

Client signs waiver (regardless of flag state)
  → POST /api/waiver → pdf-lib render → Storage upload
    → intake_forms.waiver_pdf_url, signed_at, state=waiver_signed

PT opens client_detail → intake_review
  → reads intake_forms (now readable) + essentials summary
  → red flags shown with danger treatment; gates "start session" only
```

## RPCs (all `SECURITY DEFINER`, all audit-logged)

| Function | Purpose |
|---|---|
| `invite_client(email, name, tags)` | Creates `clients` + `intake_forms` pair |
| `resend_invite(client_id, email?)` | Extends expiry, optionally re-points email |
| `revoke_invite(client_id)` | Deletes an unclaimed invite |
| `claim_client_invites()` | Links caller's verified email to matching invites |
| `set_client_state(client_id, state)` | PT-only active/paused/deactivated |
| `submit_intake(intake_id, responses)` | Client-owner only; derives red flags |
| `intake_progress(client_id)` | State + counts only, no content |

## Testing approach

- `packages/shared`: vitest, matching existing convention (`tokens.test.ts`,
  `profile.test.ts`) — PAR-Q flag derivation, completion math, unit
  conversion in `intakeSummary`.
- `db/rls_assertions.sql`: extend the existing fixture-based harness with
  M2 cases — the in-progress/completed visibility split, invite claiming
  (match / no-match / expired / idempotent), state-change authorization.
- No automated UI tests exist anywhere in this repo (`apps/mobile`,
  `apps/web`) — M2 follows that precedent. Screens are verified on-device,
  per the manual checklist in the milestone plan's Verification section.

## Risks

- No store build until M10 — every client-side check in M2–M9 rides Expo
  Go or an internal build.
- Email-match linking breaks on a client who signs up with a different
  address (e.g. Google with a personal email). Mitigated by the pre-filled
  join link and re-point flow; if support load shows this happens often, a
  redeemable token is the additive fix.
- Storage, service-role key usage, and signed URLs get their first real
  exercise a milestone earlier than planned (M4).
- Arabic PAR-Q wording is a medical-safety string, not UI copy — machine
  translation is not acceptable; flagged for the native-speaker review
  already scheduled at M10.
- Waiver legal enforceability in Lebanon/UAE depends on the still-open
  legal-entity decision (implementation design doc §6, decision #1) and is
  out of scope for this milestone.

## Deliberately out of scope

Master/Sub-PT assignment and gym rosters (M7), progress photos and body
metrics (M4), push/email notification of intake submission (M9),
PT-fills-intake-on-behalf, PT-visible in-progress answers, form-check video
(M10), an intake template editor (`INTAKE_TEMPLATE_V1` is versioned code,
not data).

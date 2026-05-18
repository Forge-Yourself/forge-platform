# Gym Account Tier + PT Hierarchy Redesign

**Date:** 2026-05-18
**Scope:** Update `docs/Forge_Architecture.html` to reflect new persona model, free Gym Account tier, Master/Sub-PT hierarchy, and payment-scope removal. No code implementation in this spec — HTML doc updates only.

---

## 1. Problem

Existing spec (`Forge_Architecture.html`, sections 02, 04, 06, 10, 11) models gyms as **paid Studio plans** (`$99/mo + $19/extra coach`) and treats `Owner / Studio Owner`, `Sub-Coach / Junior PT`, and `Studio Admin` as three distinct v3 personas. The current model assumes:

- Studio = paid customer
- Owner has full P&L visibility over sub-coaches
- Sub-Coach is hierarchically under one Studio Owner only
- Studio Admin is a separate operations role
- Heavy client-side payment infrastructure (Whish/Areeba/Stripe, no-show fees, packages, memberships, revenue split, coach payouts)

The product direction has shifted. The new model is:

- **Gym = always free.** No card. No down payment. Analytics + management screen only.
- **PT ↔ Gym is many-to-many.** A PT can be connected to any number of gyms.
- **Internal vs external PT is not a code distinction.** Same entity. Just connection state.
- **Master PT is a new role.** A PT can have sub-PTs under them; the master pays one Forge subscription that covers seats for those sub-PTs.
- **Sub-PT is a PT mode, not a separate account.** Sub-PT can also have their own Solo subscription on the same login, with data-model separation between the two contexts.
- **Studio Admin is folded into the Gym Account single login for v1.** Multi-staff roles deferred to v2+.
- **No payment between clients, PTs, and gyms.** The only payment integration in the system is for Forge admins billing PTs/clients for Forge subscriptions and AI credit packs. All client→PT and gym→PT money flows happen outside the app.

## 2. Goals

1. Rewrite section 02 (Personas & Permissions) around the new model.
2. Rebuild section 11 (Pricing) with Solo tiers kept, Master tier added, add-on packs introduced, Studio plan deprecated.
3. Replace v3 Owner/Sub-Coach/Studio Admin journeys (D3, D4, D6) with v1 Master PT, Sub-PT-under-Master, and Gym Account journeys.
4. Reframe Pillar P4 from "Business & Billing" to "Business & Scheduling" (no inter-party payments).
5. Update ERD (section 06) — add `Gym`, `GymMembership`, `GymClient`, `MasterSubRelation`, `ClientPTAssignment`, `PTMode`; remove client-side payment/pack/membership/payout entities.
6. Update phase roadmap (section 10) — Gym + Master PT ship v1; marketplace v2; events v3.
7. Update glossary — add Gym Account, Master PT, Sub-PT (under Master), PT-linked client, Gym-subbed client, PT mode; remove Owner PT / Sub-Coach / Studio Admin.
8. Add a Gym dashboard mockup section (Layout A: sidebar nav + KPI grid).

## 3. Non-Goals

- No code, no API, no migrations. HTML doc only.
- Pricing numbers for Master tier are **illustrative**, not contractually committed. Founders may revise.
- Forge Shop redesign is deferred to v3+ and out of scope for this update.
- Multi-staff Gym roles (Owner + Admin + roles) are v3, not v1.
- Marketplace UX/screens (v2) and Events UX/screens (v3) are scoped but not designed in this spec.

## 4. Decisions Locked During Brainstorming

| # | Decision |
|---|---|
| D1 | Gym Account is always free. No card, no down payment. v1 ships single shared login. |
| D2 | "Internal PT" and "External PT" are not separate entities. Same PT entity. Gym just sees connection count. |
| D3 | PT ↔ Gym is many-to-many. A PT can be connected to multiple gyms. |
| D4 | Client ↔ Gym is optional. PT decides per client whether to flag the client as gym-linked. Gym never sees progress data for PT-linked clients — only anonymized counts. |
| D5 | Gym-subbed clients (offline gym members) are entered by the gym, named, no progress data. They are separate from PT-linked clients. |
| D6 | PT join flow with gym is bidirectional: gym invites PT, or PT requests to join gym. Either party accepts/declines. |
| D7 | Master PT is a new role. Master pays one tier that covers sub-PT seats + a combined client pool. |
| D8 | Sub-PT under Master is **free** for the sub-PT (covered by master's subscription). Sub-PT can also run own Solo mode on same login with separate billing. Two modes co-exist in one Forge account; data model separates them. |
| D9 | Sub-PT sees only clients the master assigned to them. Master sees all clients across all sub-PTs. |
| D10 | Existing Solo PT tiers (Free, Pro $15, Elite $39, Power $69) are kept. Master tier is added (Master Pro $40 / Master Elite $99 / Master Power $199). Add-ons: +10 clients = $10/mo; +1 sub-PT seat = $10/mo. |
| D11 | Solo Free becomes a **30-day trial only**, not a perpetual free tier. |
| D12 | No payment between clients, PTs, gyms. Removed: no-show fees, booking deposits, packages, memberships sold to clients, multi-coach payouts, revenue splits, P&L per coach, Forge Shop commission-as-credit. Kept: scheduling, check-in/check-out (tracking only), AI credit packs (PT → Forge purchase), Client Premium $4.99/mo (client → Forge), PT/Master subs (PT → Forge). |
| D13 | Forge Shop deferred entirely to v3+. |
| D14 | Studio $99 plan is deprecated. Enterprise $499 is removed from v1 spec (revisit if/when needed). |
| D15 | Phase B (marketplace) = v2: all four sub-features (gym↔PT directory, client↔gym public listing, client↔PT-at-gym discovery, Forge Shop for gyms). |
| D16 | Phase C (events) = v3: three event modes per event (private/community, public/free, public/paid). |
| D17 | Gym dashboard layout = Layout A: sidebar nav + KPI cards (selected from visual companion). |

## 5. Personas (Section 02 Rewrite)

Cards on the personas grid:

1. **PT (Solo / Master / Sub modes)** — primary actor. Single Forge login. Operates in one or more modes; data model keeps each mode's clients/sessions/sub separated.
   - **Solo mode** — independent, owns clients, pays own Solo tier (Free trial / Pro / Elite / Power).
   - **Master mode** — has ≥1 sub-PTs. Pays Master tier (covers self + sub-PT seats + combined client pool). Sees aggregated view of all sub-PT clients.
   - **Sub-under-Master mode** — connected to a Master PT. App access covered by master's sub. Sees only master-assigned clients.
2. **Client** — trains 1-5×/wk. Free if invited by PT (counts against PT's plan cap). $4.99/mo Premium if self-serve with no PT.
3. **Gym Account** — gym entity, always free, no card. v1 = single shared login. Purpose: PT roster management, gym-subbed (offline) client list, calendar/space booking, gym profile/branding, analytics on counts. Cannot see PT-owned client data; sees only counts for PT-linked clients. Marketplace + events deferred (Phase B/C).
4. **Platform Admin** — Forge-internal. Unchanged.

**Removed cards (collapsed):**
- *Owner / Studio Owner* → replaced by **Gym Account** (free) + **Master PT** (paid mode).
- *Sub-Coach / Junior PT* → renamed to **Sub-PT under Master PT** (PT-under-PT, not PT-under-gym).
- *Studio Admin* → folded into **Gym Account** single login for v1.

## 6. Permission Matrix (Section 02 Rewrite)

Columns: **Solo PT · Master PT · Sub-PT · Client · Gym · Admin**

| Capability | Solo | Master | Sub | Client | Gym | Admin |
|---|---|---|---|---|---|---|
| Manage own profile | Y | Y | Y | Y | Y | Y |
| Manage sub-PTs (invite, assign clients, remove) | — | Y | — | — | — | — |
| Invite clients | Y | Y | Y | — | Y (gym-subbed only) | — |
| Build programs | Y | Y | Y | Y | — | — |
| Log session | Y | Y | Y | Y (self) | — | — |
| Schedule sessions | Y | Y | Y | request | space-book only | Y |
| Connect to gym(s) | Y | Y | Y | via PT or self-subscribe to gym | n/a | — |
| Invite PTs to gym | — | — | — | — | Y | — |
| Accept PT join requests | — | — | — | — | Y | — |
| Accept gym invites | Y | Y | Y | — | — | — |
| Assign client to sub-PT | — | Y | — | — | — | — |
| See own clients | own | own + all sub-PT clients | own assigned only | self | gym-subbed (name, no progress) | Y |
| See client counts | own | aggregate (master + subs) | own assigned | — | gym-subbed named + PT-linked anonymous | Y |
| View own Forge subscription | Y | Y | Y (if Solo mode on same account) | Y (if self-Premium) | n/a (free) | view all |

## 7. Pricing (Section 11 Rewrite)

### Solo PT plans (existing pricing kept; Free changes to trial)

| Tier | Price | Clients | Notes |
|---|---|---|---|
| Free | $0 | 3 | **30-day trial only**, auto-prompt to Pro on day 30 |
| Pro | $15/mo | 5 | $3.00/client |
| Elite | $39/mo | 25 | $1.56/client |
| Power | $69/mo | unlimited | flat |

### Master PT plans (new, accounting-aligned to Solo)

Per-PT cost ≈ $13-$17; per-client cost drops from $1.00 → $0.66 across tiers, mirroring Solo's $3.00 → $1.56 → flat pattern. Each tier is below the Solo equivalent multiplied by PT count (bulk discount).

| Tier | Price | Sub-PT seats | Clients combined | Per-PT | Per-client |
|---|---|---|---|---|---|
| Master Pro | $40/mo | 2 | 40 | $13.33 (3 PTs) | $1.00 |
| Master Elite | $99/mo | 5 | 100 | $16.50 (6 PTs) | $0.99 |
| Master Power | $199/mo | 12 | 300 | $15.31 (13 PTs) | $0.66 |

Pricing numbers are illustrative; founders may adjust before launch.

### Add-ons (apply to Solo or Master)

| Add-on | Price | Effect |
|---|---|---|
| Extra client pack | $10/mo | +10 client cap |
| Extra sub-PT seat | $10/mo | +1 sub-PT seat under master |

### Other (kept)

- **Client Premium:** $4.99/mo (only if no PT).
- **AI credit packs:** Starter $5/10 · Standard $15/40 · Power $39/120 · Mega $99/350.
- **Gym Account:** $0 always.

### Sub-PT pricing

- Sub-PT under Master = $0 (covered by master seat).
- Sub-PT with own Solo mode on same account = pays own Solo tier separately. Two billings, one login. Data-model separation between master-shared work and own Solo work.

### Deprecated / removed

- Studio $99/mo plan → replaced by Master Pro $40 + add-ons.
- Enterprise $499/mo → removed from v1; revisit later.
- 0%-transaction-fee marketing line → removed (no inter-party transactions to take a fee from).
- Founding-member 50% off / Educational 30% off → kept, apply to Solo + Master subs.

### Revenue flow (D50 rewrite)

```
PT (Solo / Master / Sub-Solo) --subscription $0-$199--> FORGE
PT / Master --AI credit pack--> FORGE
Client (no PT) --$4.99 Premium--> FORGE
Gym ----- $0 (always free) ----- FORGE
[no inter-party payment lines]
```

## 8. Journeys (Section 04 Updates)

### D2 Solo PT journey (v1) — small edit
- **Remove:** "KYC: Whish merchant + Areeba account", "First payment received Whish or card or cash".
- **Replace:** "First payment received" → "First session logged + AI recap".
- **Add:** "Subscribe to Pro (or stay Free 30 days)" after profile build.

### D3 — REPLACE: Master PT journey (v1)
```
A[Master PT signs up] --> B[Subscribe to Master tier]
B --> C[Invite Sub-PT by email or link]
C --> D[Sub-PT accepts, joins under Master]
D --> E[Master assigns clients to Sub-PT]
E --> F[Sub-PT runs sessions, logs sets]
F --> G[Master dashboard: aggregate view of all sub-PT clients]
G --> H[AI recap across roster]
H --> I{Capacity hit?}
I -->|yes| J[Buy +10 client pack or upgrade tier]
I -->|no| G
```

### D4 — RENAME + REWRITE: Sub-PT-under-Master journey (v1)
```
A[Receive Master invite email or link] --> B[Sign up or log in]
B --> C[Accept Master invite]
C --> D[See only Master-assigned clients]
D --> E[Run session, log sets]
E --> F[Optional: add own Solo subscription on same account]
F --> G[Toggle context: Master mode vs Solo mode]
G --> D
```

### D5 Client journey (v1) — edit
- **Remove:** all payment steps (Whish/Areeba/cash).
- **Add:** "If PT-invited → free under PT plan" vs "No PT → subscribe $4.99 Premium".
- **Keep:** log own session, see progress, receive nudges.

### D6 — REPLACE: Gym Account journey (v1)
```
A[Gym admin signs up, no card] --> B[Create gym profile: name, logo, address, hours]
B --> C[Browse PT directory or paste invite emails]
C --> D[Send PT invites OR receive PT join requests]
D --> E[Accept PTs, build roster]
E --> F[Add offline gym-subbed clients: name, contact]
F --> G[Open calendar: PTs reserve space and time]
G --> H[Dashboard: PT count, gym-subbed client list, PT-linked client count anonymized]
H --> I{Phase B/C}
I -->|v2| J[Marketplace: list gym, attract PTs and clients]
I -->|v3| K[Post events: private / public-free / public-paid]
```

## 9. Gym Dashboard Mockup (new subsection)

**Selected layout: A — sidebar nav + KPI grid.**

```
+---------------------------------------------------------------+
| GoldGym BEY                                                   |
+----------+----------------------------------------------------+
| Dashboard|  [PTs connected]      [Gym-subbed clients]         |
| PT Roster|  12 active · 3 pending  87 named members           |
| Gym      |                                                    |
|  Clients |  [PT-linked clients]    [Today space]              |
| Calendar |  ~140 anonymous count   5 PTs booked · 2 rooms free|
| Profile  |                                                    |
| ──       |  [Recent join activity]                            |
| (v2)     |  · PT Sarah requested to join                      |
| Market-  |  · Member John added by front desk                 |
|  place   |  · Room 2 booked 14:00 by PT Ahmad                 |
| (v3)     |  · PT Maya invite accepted                         |
| Events   |  · 5 sessions today                                |
+----------+----------------------------------------------------+
```

Left nav fixed: Dashboard · PT Roster · Gym Clients · Calendar · Profile · (v2 Marketplace, v3 Events — disabled until those phases).

Dashboard cards: PTs connected · Gym-subbed clients · PT-linked clients (anon) · Today space · Recent join activity feed.

## 10. ERD Updates (Section 06)

### Add entities

| Entity | Fields | Purpose |
|---|---|---|
| `Gym` | id, name, logo, address, hours, contact, profile_md | Free gym entity. No billing fields. |
| `GymMembership` | (pt_id, gym_id, state ∈ {invited, requested, active, left}, initiated_by, joined_at, left_at) | M:N junction between PT and Gym with join-state machine. |
| `GymClient` | gym_id, client_name, contact, joined_at, notes | Offline gym-subbed member. **Not linked** to a Forge `Client` unless that person also has a Forge client account. |
| `MasterSubRelation` | master_pt_id, sub_pt_id, state, joined_at, left_at | 1:N master → sub-PTs. **No revenue field.** |
| `ClientPTAssignment` | client_id, pt_id, master_id (nullable) | Master assigns specific clients to specific sub-PTs. Sub-PT only sees clients via this table. |
| `PTMode` | pt_id, mode ∈ {solo, master, sub_under_master}, master_id (nullable), active, started_at | One PT account can have multiple rows (e.g., one `solo` + one `sub_under_master`). |

### Modify entities

- **`Subscription`** — product set shrinks to: Solo Free-trial, Solo Pro, Solo Elite, Solo Power, Master Pro, Master Elite, Master Power, Client Premium, AI credit pack, add-on packs. Removed: client→PT product SKUs, no-show fee SKUs.
- **`WorkoutSession`** — add optional `gym_id` (drives PT-linked-client gym count, anonymous to gym).
- **`Booking`** — drop `deposit_amount`, `no_show_fee` fields. No payment integration.

### Remove entities / fields

- Whish merchant / Areeba merchant onboarding entities (PT side).
- `Pack`, `Membership`, `Order` (client-side product/membership/order — only Forge subscription `Order` kept).
- Revenue split tables, Payout tables, P&L-per-coach views.
- Forge Shop entities → deferred to v3+.

### ERD diagrams to update

D11-D14 master ERD + subdomain ERDs.

- Coaching subgraph: add `Gym`, `GymMembership`, `MasterSubRelation`, `ClientPTAssignment`, `PTMode`.
- Business subgraph: collapse to Forge subscription only (Subscription, Invoice, AI credits, Client Premium).
- Marketplace subgraph: defer to v2 ERD addendum.

## 11. Phase Roadmap (Section 10 Updates)

| Phase | Scope |
|---|---|
| **v1** | Gym Account (free, basic Layout-A screen), PT join flow (invite + request bidirectional), Master PT tier + Sub-PT under master, PT-mode switching same login (Solo / Master / Sub), gym-subbed client list (named, no progress), PT-linked clients (anonymous counts), space booking calendar, gym branding/profile. **Pillar P4 reframed → "Business & Scheduling"** (no inter-party $). |
| **v1.5** | Hardening, UAE prep, KYC for **Forge** subscription billing only. |
| **v2** | Marketplace — gym↔PT directory, client↔gym public listing, client↔PT-at-gym discovery, Forge Shop targeted at gyms. |
| **v3** | Events — three modes per event (private/community, public/free, public/paid). Multi-staff gym roles (Owner + Admin). Forge Shop full. |

## 12. Pillar P4 Reframe (Section 03)

"Business & Billing" → **"Business & Scheduling"**.

- **Drop:** bookings-with-payment, recurring memberships sold to clients, no-show fees, multi-coach payouts, revenue splits, tax-free exports of client-revenue.
- **Keep:** schedules, check-in / check-out (tracking only), capacity caps tied to subscription tier, Forge subscription billing dashboard for Platform Admin.

## 13. Glossary Updates

### Add
- **Gym Account** — free, non-billable entity. Hosts PT roster, gym-subbed client list, calendar. v1 = single shared login.
- **Master PT** — PT mode where sub-PTs are managed. Pays Master tier. Sees aggregate view of all sub-PT clients.
- **Sub-PT (under Master)** — PT mode connected to a Master. App access covered by master's sub. Sees only master-assigned clients. May also run Solo mode on same login.
- **PT-linked client** — client invited by a PT. Free under PT cap. Visible to PT, anonymous (count only) to any linked Gym.
- **Gym-subbed client** — offline gym member added by Gym Account. Named to Gym. No progress data tied unless they also become a PT-linked client.
- **PT mode** — Solo / Master / Sub-under-Master. One Forge account, one login, ≥1 active mode.

### Rename
- *Sub-Coach / Junior PT* → **Sub-PT (under Master PT)**.

### Remove
- *Owner / Studio Owner* — replaced by Gym Account + Master PT.
- *Studio Admin* — folded into Gym single login (v1). v3 may reintroduce as optional multi-staff role.

## 14. HTML Sections Touched

A separate implementation pass on `docs/Forge_Architecture.html` will touch:

- **Section 02 (Personas & Permissions)** — full rewrite per §5, §6 above.
- **Section 03 (Product Pillars)** — Pillar P4 reframe (§12).
- **Section 04 (User Journeys)** — D2 edit, D3 replace, D4 rename+rewrite, D5 edit, D6 replace (§8).
- **Section 06 (Data Model / ERD)** — entity additions + modifications + removals; D11-D14 mermaid updates (§10).
- **Section 07 (Sequences)** — drop payment-flow sequences (D40-D45 range for client→PT $); keep Forge-subscription sequences only.
- **Section 08 (State Machines)** — drop Pack, Membership state machines; keep Subscription (for Forge billing), Booking, WorkoutSession.
- **Section 10 (Phase Roadmap)** — update phase scope per §11; D62 mermaid roadmap updated.
- **Section 11 (Pricing)** — full rewrite per §7; D50 revenue flow updated.
- **Section 13 (Glossary)** — per §13.
- **New subsection** under personas or business: **Gym Dashboard Mockup** (§9, Layout A ASCII or HTML mock).

## 15. Open Items (Optional Polish)

- Exact tier names for Master plans (Master Pro / Elite / Power) — kept symmetric with Solo but founders may rename.
- Whether Sub-PT toggle between Solo and Master modes is a context-switcher control or auto-derived from the active screen — UX detail, not spec-blocking.
- Whether `GymClient` should evolve into a stub Forge Client account if the gym member later registers their own login — data model question, deferred to implementation.
- Whether the Gym Account journey D6 should explicitly call out a "PT directory browse" step before v2 marketplace ships — current v1 model uses paste-email or invite-link only; directory is a v2 add.

## 16. Approval Gate

This spec is the design artifact for the Architecture HTML update only. **No code, no API, no migration is implied.** After user approval, next step is the implementation pass on `docs/Forge_Architecture.html` to land all the sections listed in §14.

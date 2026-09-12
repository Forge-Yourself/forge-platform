# Forge Database Schema

54 tables across 15 domains for PostgreSQL 15+.

## Quick Start

```bash
psql -U postgres -c "CREATE DATABASE forge;"
psql -U postgres -d forge -f db/schema.sql
psql -U postgres -d forge -f db/seed.sql
```

## Files

| File | Purpose |
|---|---|
| `schema.sql` | Complete DDL: extensions, 54 tables, indexes, constraints, partitions, triggers. **Historical reference — see the header warning; `supabase/migrations/` is authoritative.** |
| `seed.sql` | Reference data: 15 badges, 41 exercises. The exercises are superseded by, and absorbed verbatim into, migration `0008` — that migration is what actually populates a deployed library, and it carries all 41 of these slugs. |
| `exercises/forge_exercise_library_v1.json` | The curated exercise library source of truth: 205 movements covering every `muscle_group`, `equipment` and `movement_pattern` CHECK value. Edit this, never the generated SQL. |
| `exercises/build_import_sql.mjs` | Validates that JSON against the CHECK value lists (and refuses to emit on a coverage gap), then compiles it deterministically into `supabase/migrations/0008_exercise_library_v1.sql`. The eventual 2,000+ licensed import is a regeneration of the same file from a longer JSON — data only, no code change. |
| `rls_assertions.sql` | The RLS assertion harness: 85 assertions run inside a transaction that ends in `ROLLBACK`. |

## Domain Map

| # | Domain | Tables | Count |
|---|---|---|---|
| 1 | Identity & Auth | users, user_sessions, device_tokens, audit_logs | 4 |
| 2 | PT Modes & Hierarchy | pt_profiles, pt_modes, master_sub_relations | 3 |
| 3 | Coaching | clients, client_pt_assignments, intake_forms | 3 |
| 4 | Gym | gyms, gym_memberships, gym_clients | 3 |
| 5 | Programming | exercises, programs, program_weeks, program_days, program_blocks, program_exercises | 6 |
| | | *M3 note: `program_days`, `program_blocks` and `program_exercises` each carry a denormalised `program_id`, guarded by a composite FK to their parent's `(id, program_id)`. It exists so every RLS policy on those tables is one predicate call rather than a 3-4 join chain per row — and the composite FK is what makes a drifted value structurally impossible. Any new write path must set it.* | |
| 6 | Logging & Sessions | workout_sessions, sets, exercise_prs, body_metrics, progress_photos | 5 |
| 7 | Nutrition | meal_plans, food_items, food_logs | 3 |
| 8 | Scheduling & Bookings | schedules, classes, bookings, check_ins | 4 |
| 9 | Billing & Subscriptions | subscriptions, subscription_addons, charges, ai_credit_wallets, ai_credit_packs | 5 |
| 10 | AI | ai_generations | 1 |
| 11 | Communication | messages, message_recipients, video_sessions | 3 |
| 12 | Form-Check Video | form_check_uploads, form_check_comments | 2 |
| 13 | Notifications | notifications, notification_preferences | 2 |
| 14 | Gamification | streaks, badges, user_badges, challenges, challenge_participants | 5 |
| 15 | Marketplace | listings, events, tickets, products, orders | 5 |

## Version Roadmap

| Version | Tables | Description |
|---|---|---|
| v1 | 40 | Core: auth, coaching, programming, logging, scheduling, billing, notifications, gamification basics |
| v1.5 | 2 | challenges, challenge_participants |
| v2 | 3 | classes, video_sessions, listings |
| v3 | 4 | events, tickets, products, orders |

## Key Design Decisions

- **UUIDv7** PKs (time-ordered) on all tables except `sets` which uses **ULID** (client-generated for offline-first)
- **CITEXT** for emails (case-insensitive per RFC 5321)
- **PostGIS GEOGRAPHY(Point, 4326)** for gym locations
- **NUMERIC(3,1)** for RPE (half-point: 7.5, 8.5)
- **Prices in cents (INTEGER)** — no floating-point currency
- **CHECK constraints** for state enums (not CREATE TYPE — easier migrations)
- **Partitioned** (monthly range): sets, food_logs, notifications, audit_logs
- **Append-only** audit_logs via REVOKE UPDATE/DELETE
- **Application-enforced FKs** from partitioned tables (PostgreSQL limitation)

## Partitioned Tables

| Table | Partition Key | Notes |
|---|---|---|
| sets | created_at | ULID PK, highest volume |
| food_logs | logged_date | Daily nutrition logs |
| notifications | created_at | High-volume delivery tracking |
| audit_logs | created_at | Append-only, compliance retention |

Each ships with 6 monthly partitions (May–Oct 2026). Add new partitions before each month:

```sql
CREATE TABLE sets_2026_11 PARTITION OF sets
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
```

## Relationship Diagram

```
users ──1:1──> pt_profiles
users ──1:N──> user_sessions, device_tokens, pt_modes
users ──1:N──> clients (as PT), clients (as client user)
users ──1:N──> gyms (as owner), gym_memberships (as PT)
users ──1:1──> ai_credit_wallets

clients ──1:N──> intake_forms, workout_sessions, body_metrics
clients ──1:N──> progress_photos, exercise_prs, meal_plans, food_logs
clients ──1:N──> form_check_uploads

programs ──1:N──> program_weeks ──1:N──> program_days
program_days ──1:N──> program_blocks ──1:N──> program_exercises
exercises ──1:N──> program_exercises (RESTRICT)

workout_sessions ──1:N──> sets (app-enforced FK)
bookings ──1:1──> check_ins, video_sessions, workout_sessions

subscriptions ──1:N──> subscription_addons, charges
ai_credit_wallets ──1:N──> ai_credit_packs

messages ──1:N──> message_recipients
badges ──1:N──> user_badges
challenges ──1:N──> challenge_participants
events ──1:N──> tickets
```

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Forge** is a PT-first (personal trainer) SaaS platform for trainers, studios, and the people they coach. Lebanon-first market, expanding to UAE.

- **Phase:** Pre-development (documentation and database schema only)
- **Repository:** Monorepo (planned)
- **Status:** No application code yet — architecture docs and DB schema are the deliverables so far

## Documentation

All product documentation lives in `docs/`. Start at `docs/index.html` for the hub.

| Document | Purpose |
|---|---|
| `docs/Forge_Architecture.html` | **Primary source of truth.** 14 sections, 51 Mermaid diagrams: ERD (D11-D15), runtime flows (D16-D32), lifecycles (D33-D39), epics (EP-01 to EP-21), pricing, NFR, compliance |
| `docs/Forge_Brand.html` | Brand guidelines, colors, typography |
| `docs/Forge_DesignSystem.html` | Component library, spacing, dark mode tokens |
| `docs/superpowers/specs/*.md` | Design decision specs (gym tier, PT hierarchy) |

## Tech Stack (Planned)

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo) |
| Web dashboard | Next.js 14+ (App Router) |
| API | NestJS or Fastify (Node.js) |
| Database | PostgreSQL 15+ with pgcrypto, citext, pg_trgm, postgis, btree_gist |
| Cache / Queues | Redis |
| Object Storage | S3 (progress photos, videos, voice notes) |
| Payments (v1) | Whish + Areeba (Lebanon), Apple/Google IAP |
| Payments (v2) | Stripe (UAE expansion) |
| Real-time | WebSockets (set logging, notifications) |
| AI | Claude API (program drafts, meal plans, monthly recaps) |

## Four Personas

1. **PT (Personal Trainer)** — operates in one of three modes:
   - **Solo:** independent trainer, manages own clients
   - **Master:** runs a team of Sub-PTs, assigns clients, sees all data
   - **Sub-under-Master:** works under a Master PT, sees only assigned clients
2. **Client** — trains under a PT, logs workouts, tracks nutrition
3. **Gym Account** — always free, no card required. Manages PT roster and offline member lists
4. **Platform Admin** — Forge staff, compliance, support

## Six Product Pillars

1. **P1 Logging** — offline-first set logging with ULID PKs, voice input, PR tracking
2. **P2 Programming** — program builder (weeks → days → blocks → exercises), AI draft generation
3. **P3 Coaching** — client onboarding, intake forms, progress photos, form-check video review
4. **P4 Business & Scheduling** — booking calendar, QR check-in, recurring sessions, Google Calendar sync
5. **P5 Insights & AI** — dashboards, monthly recaps, AI credit wallet system
6. **P6 Marketplace & Growth** — gym directory, PT listings, events, Forge Shop (v2/v3)

## Database Schema

Located in `db/`:

| File | Content |
|---|---|
| `db/schema.sql` | Complete DDL: 54 tables, indexes, constraints, partitions, triggers |
| `db/seed.sql` | Reference data: badge definitions, exercise stubs |
| `db/README.md` | Domain map, table inventory, relationship diagram |

### Key Architecture Decisions

- **UUIDv7** for all PKs (time-ordered), except `sets` table which uses **ULID** (client-generated for offline-first sync)
- **CITEXT** for emails (case-insensitive)
- **PostGIS GEOGRAPHY** for gym coordinates
- **CHECK constraints** for state enums (not CREATE TYPE — easier migrations)
- **Partitioned tables:** `sets`, `food_logs`, `notifications`, `audit_logs` (monthly range)
- **Append-only `audit_logs`** enforced via REVOKE UPDATE/DELETE
- **Application-enforced FKs** from partitioned tables (PostgreSQL limitation)
- **No inter-party payments** — Forge is always merchant of record (PT/Client pay Forge only)

### Running the Schema Locally

```bash
psql -U postgres -c "CREATE DATABASE forge;"
psql -U postgres -d forge -f db/schema.sql
psql -U postgres -d forge -f db/seed.sql
```

## Phase Roadmap

| Phase | Scope |
|---|---|
| v1 | Core: auth, client management, program builder, set logging, scheduling, billing, notifications (40 tables) |
| v1.5 | Challenges, gamification enhancements (2 tables) |
| v2 | Group classes, video sessions, marketplace listings (3 tables) |
| v3 | Events, tickets, Forge Shop (4 tables) |

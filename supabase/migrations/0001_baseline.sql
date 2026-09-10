-- =============================================================================
-- Forge Platform — PostgreSQL Database Schema
-- 54 tables across 15 domains | ~600 columns
-- Generated from Architecture Doc (D11-D15, D16-D32, D33-D39, EP-01–EP-21)
-- and Gym Account Tier Design Spec
-- =============================================================================
-- Target: PostgreSQL 15+
-- Extensions: pgcrypto, citext, pg_trgm, postgis, btree_gist
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0.1 Utility functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Reusable updated_at trigger function
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- UUIDv7 generation (timestamp-ordered UUIDs)
-- Falls back to gen_random_uuid() if pg_uuidv7 extension is not available
CREATE OR REPLACE FUNCTION uuid_v7()
RETURNS UUID AS $$
DECLARE
  ts_ms  BIGINT;
  uuid_bytes BYTEA;
BEGIN
  ts_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
  uuid_bytes := decode(
    lpad(to_hex(ts_ms), 12, '0') ||
    encode(gen_random_bytes(10), 'hex'),
    'hex'
  );
  -- Set version 7 (bits 48-51)
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & x'0F'::INT) | x'70'::INT);
  -- Set variant 2 (bits 64-65)
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & x'3F'::INT) | x'80'::INT);
  RETURN encode(uuid_bytes, 'hex')::UUID;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- =============================================================================
-- DOMAIN 1: IDENTITY & AUTH (4 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 1: users [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                    UUID        NOT NULL DEFAULT uuid_v7(),
  role                  VARCHAR(20) NOT NULL,
  email                 CITEXT      NOT NULL,
  phone                 VARCHAR(20),
  display_name          VARCHAR(100) NOT NULL,
  avatar_url            TEXT,
  locale                VARCHAR(10) NOT NULL DEFAULT 'en',
  unit_system           VARCHAR(10) NOT NULL DEFAULT 'metric',
  auth_provider         VARCHAR(20) NOT NULL DEFAULT 'email',
  password_hash         TEXT,
  mfa_enabled           BOOLEAN     NOT NULL DEFAULT FALSE,
  mfa_method            VARCHAR(20),
  mfa_key_id            VARCHAR(100),
  failed_login_count    SMALLINT    NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  consent_analytics     BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_marketing     BOOLEAN     NOT NULL DEFAULT FALSE,
  consent_ai_training   BOOLEAN     NOT NULL DEFAULT FALSE,
  onboarding_completed  BOOLEAN     NOT NULL DEFAULT FALSE,
  timezone              VARCHAR(50) NOT NULL DEFAULT 'Asia/Beirut',
  is_quarantined        BOOLEAN     NOT NULL DEFAULT FALSE,
  quarantine_reason     TEXT,
  is_deleted            BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_users PRIMARY KEY (id),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT chk_users_role CHECK (role IN ('pt', 'client', 'gym_account', 'admin')),
  CONSTRAINT chk_users_unit_system CHECK (unit_system IN ('metric', 'imperial')),
  CONSTRAINT chk_users_auth_provider CHECK (auth_provider IN ('email', 'google', 'apple', 'facebook')),
  CONSTRAINT chk_users_mfa_method CHECK (mfa_method IS NULL OR mfa_method IN ('totp', 'sms')),
  CONSTRAINT chk_users_locale CHECK (locale IN ('en', 'ar', 'fr'))
);

CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_deleted ON users (is_deleted) WHERE is_deleted = TRUE;
CREATE INDEX idx_users_email_trgm ON users USING gin (email gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 2: user_sessions [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE user_sessions (
  id                UUID        NOT NULL DEFAULT uuid_v7(),
  user_id           UUID        NOT NULL,
  refresh_token_hash VARCHAR(128) NOT NULL,
  family_id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  device_info       JSONB,
  ip_address        INET,
  user_agent        TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_user_sessions PRIMARY KEY (id),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_usess_user ON user_sessions (user_id);
CREATE INDEX idx_usess_family ON user_sessions (family_id);
CREATE INDEX idx_usess_expires ON user_sessions (expires_at) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 3: device_tokens [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE device_tokens (
  id           UUID        NOT NULL DEFAULT uuid_v7(),
  user_id      UUID        NOT NULL,
  platform     VARCHAR(10) NOT NULL,
  token        TEXT        NOT NULL,
  device_name  VARCHAR(100),
  app_version  VARCHAR(20),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_device_tokens PRIMARY KEY (id),
  CONSTRAINT fk_device_tokens_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_device_tokens_user_token UNIQUE (user_id, token),
  CONSTRAINT chk_device_tokens_platform CHECK (platform IN ('ios', 'android', 'web'))
);

CREATE INDEX idx_dt_user ON device_tokens (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 4: audit_logs [v1] — PARTITIONED, APPEND-ONLY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              UUID        NOT NULL DEFAULT uuid_v7(),
  actor_id        UUID,
  target_user_id  UUID,
  action          VARCHAR(50) NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       UUID,
  reason_code     VARCHAR(50),
  ip_address      INET,
  user_agent      TEXT,
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_audit_logs PRIMARY KEY (id, created_at),
  CONSTRAINT chk_audit_logs_action CHECK (action IN (
    'user_register', 'user_login', 'user_logout', 'user_login_failed',
    'user_mfa_enable', 'user_mfa_disable', 'user_password_change',
    'user_delete', 'user_quarantine', 'user_unquarantine',
    'client_invite', 'client_accept', 'client_pause', 'client_deactivate',
    'pt_mode_create', 'pt_mode_switch',
    'master_sub_invite', 'master_sub_accept', 'master_sub_leave',
    'gym_create', 'gym_membership_invite', 'gym_membership_accept', 'gym_membership_leave',
    'program_create', 'program_assign', 'program_archive',
    'workout_start', 'workout_complete', 'workout_review',
    'booking_create', 'booking_cancel', 'booking_no_show', 'booking_complete',
    'check_in', 'check_out',
    'subscription_create', 'subscription_cancel', 'subscription_renew', 'subscription_tier_change',
    'charge_succeed', 'charge_fail', 'charge_refund',
    'ai_credit_purchase', 'ai_credit_consume', 'ai_credit_refund',
    'ai_generation_create',
    'gdpr_export', 'gdpr_delete',
    'admin_action'
  ))
) PARTITION BY RANGE (created_at);

-- Create initial monthly partitions (6 months)
CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_logs_2026_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- FK references are SET NULL to preserve audit trail on user deletion
-- These cannot be declared as formal FKs on partitioned tables, so app-enforced
-- actor_id -> users.id (SET NULL)
-- target_user_id -> users.id (SET NULL)

CREATE INDEX idx_audit_actor ON audit_logs (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_target ON audit_logs (target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX idx_audit_action ON audit_logs (action, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id) WHERE entity_type IS NOT NULL;


-- =============================================================================
-- DOMAIN 2: PT MODES & HIERARCHY (3 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 5: pt_profiles [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pt_profiles (
  id                UUID         NOT NULL DEFAULT uuid_v7(),
  user_id           UUID         NOT NULL,
  bio               TEXT,
  certifications    TEXT[]       NOT NULL DEFAULT '{}',
  specializations   TEXT[]       NOT NULL DEFAULT '{}',
  languages         TEXT[]       NOT NULL DEFAULT '{en}',
  years_experience  SMALLINT,
  slug              VARCHAR(100),
  hourly_rate_cents INTEGER,
  currency          VARCHAR(3)   DEFAULT 'USD',
  profile_photo_url TEXT,
  is_published      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_pt_profiles PRIMARY KEY (id),
  CONSTRAINT fk_pt_profiles_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_pt_profiles_user UNIQUE (user_id),
  CONSTRAINT uq_pt_profiles_slug UNIQUE (slug),
  CONSTRAINT chk_pt_profiles_currency CHECK (currency IN ('USD', 'AED')),
  CONSTRAINT chk_pt_profiles_rate CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents > 0)
);

CREATE INDEX idx_ptp_specializations ON pt_profiles USING gin (specializations);
CREATE INDEX idx_ptp_languages ON pt_profiles USING gin (languages);
CREATE INDEX idx_ptp_certifications ON pt_profiles USING gin (certifications);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 6: pt_modes [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pt_modes (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  pt_user_id  UUID        NOT NULL,
  mode        VARCHAR(20) NOT NULL,
  master_id   UUID,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_pt_modes PRIMARY KEY (id),
  CONSTRAINT fk_pt_modes_user FOREIGN KEY (pt_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_modes_master FOREIGN KEY (master_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_pt_modes_mode CHECK (mode IN ('solo', 'master', 'sub_under_master')),
  CONSTRAINT chk_pt_modes_sub_requires_master CHECK (
    mode != 'sub_under_master' OR master_id IS NOT NULL
  )
);

-- Only one active mode of each type per PT
CREATE UNIQUE INDEX uq_pt_modes_active ON pt_modes (pt_user_id, mode) WHERE is_active = TRUE;
CREATE INDEX idx_pt_modes_master ON pt_modes (master_id) WHERE master_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 7: master_sub_relations [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE master_sub_relations (
  id               UUID        NOT NULL DEFAULT uuid_v7(),
  master_pt_id     UUID        NOT NULL,
  sub_pt_id        UUID        NOT NULL,
  state            VARCHAR(20) NOT NULL DEFAULT 'invited',
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ,
  left_at          TIMESTAMPTZ,
  invite_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_master_sub_relations PRIMARY KEY (id),
  CONSTRAINT fk_msr_master FOREIGN KEY (master_pt_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_msr_sub FOREIGN KEY (sub_pt_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_msr_state CHECK (state IN ('invited', 'accepted', 'active', 'left')),
  CONSTRAINT chk_msr_not_self CHECK (master_pt_id != sub_pt_id)
);

CREATE UNIQUE INDEX uq_msr_active ON master_sub_relations (master_pt_id, sub_pt_id)
  WHERE state IN ('invited', 'accepted', 'active');
CREATE INDEX idx_msr_sub ON master_sub_relations (sub_pt_id);


-- =============================================================================
-- DOMAIN 3: COACHING (3 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 8: clients [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE clients (
  id               UUID        NOT NULL DEFAULT uuid_v7(),
  pt_user_id       UUID        NOT NULL,
  client_user_id   UUID,
  pt_mode_id       UUID,
  gym_id           UUID,
  state            VARCHAR(20) NOT NULL DEFAULT 'invited',
  invite_email     CITEXT,
  invite_expires_at TIMESTAMPTZ,
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  is_premium_self_serve BOOLEAN NOT NULL DEFAULT FALSE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_clients PRIMARY KEY (id),
  CONSTRAINT fk_clients_pt FOREIGN KEY (pt_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_clients_user FOREIGN KEY (client_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_clients_pt_mode FOREIGN KEY (pt_mode_id)
    REFERENCES pt_modes(id) ON DELETE SET NULL,
  CONSTRAINT chk_clients_state CHECK (state IN (
    'invited', 'accepted', 'active', 'paused', 'deactivated'
  ))
  -- gym_id FK added after gyms table is created
);

CREATE INDEX idx_clients_pt ON clients (pt_user_id, state);
CREATE INDEX idx_clients_user ON clients (client_user_id) WHERE client_user_id IS NOT NULL;
CREATE INDEX idx_clients_pt_mode ON clients (pt_mode_id) WHERE pt_mode_id IS NOT NULL;
CREATE INDEX idx_clients_tags ON clients USING gin (tags);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 9: client_pt_assignments [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE client_pt_assignments (
  id              UUID        NOT NULL DEFAULT uuid_v7(),
  client_id       UUID        NOT NULL,
  pt_user_id      UUID        NOT NULL,
  master_user_id  UUID        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_client_pt_assignments PRIMARY KEY (id),
  CONSTRAINT fk_cpa_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_cpa_pt FOREIGN KEY (pt_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cpa_master FOREIGN KEY (master_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_cpa_not_self CHECK (pt_user_id != master_user_id)
);

CREATE UNIQUE INDEX uq_cpa_active ON client_pt_assignments (client_id, pt_user_id)
  WHERE is_active = TRUE;
CREATE INDEX idx_cpa_pt ON client_pt_assignments (pt_user_id) WHERE is_active = TRUE;
CREATE INDEX idx_cpa_master ON client_pt_assignments (master_user_id) WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 10: intake_forms [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE intake_forms (
  id               UUID        NOT NULL DEFAULT uuid_v7(),
  client_id        UUID        NOT NULL,
  state            VARCHAR(20) NOT NULL DEFAULT 'pending',
  template_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  sections         JSONB       NOT NULL DEFAULT '[]',
  responses        JSONB       NOT NULL DEFAULT '{}',
  red_flags        JSONB,
  waiver_pdf_url   TEXT,
  signed_at        TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  reviewed_by_id   UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_intake_forms PRIMARY KEY (id),
  CONSTRAINT fk_intake_forms_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_intake_forms_reviewer FOREIGN KEY (reviewed_by_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_intake_forms_state CHECK (state IN (
    'pending', 'in_progress', 'completed', 'red_flag_review', 'waiver_signed'
  ))
);

CREATE INDEX idx_intake_client ON intake_forms (client_id);
CREATE INDEX idx_intake_state ON intake_forms (state) WHERE state NOT IN ('completed', 'waiver_signed');


-- =============================================================================
-- DOMAIN 4: GYM (3 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 11: gyms [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE gyms (
  id               UUID         NOT NULL DEFAULT uuid_v7(),
  owner_user_id    UUID         NOT NULL,
  name             VARCHAR(200) NOT NULL,
  name_ar          VARCHAR(200),
  slug             VARCHAR(100),
  location         GEOGRAPHY(Point, 4326),
  address          TEXT,
  city             VARCHAR(100),
  country          VARCHAR(3),
  operating_hours  JSONB,
  amenities        TEXT[]       NOT NULL DEFAULT '{}',
  logo_url         TEXT,
  cover_image_url  TEXT,
  description      TEXT,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_gyms PRIMARY KEY (id),
  CONSTRAINT fk_gyms_owner FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_gyms_slug UNIQUE (slug),
  CONSTRAINT chk_gyms_country CHECK (country IS NULL OR country IN ('LBN', 'ARE', 'SAU', 'JOR', 'KWT', 'QAT', 'BHR', 'OMN'))
);

CREATE INDEX idx_gyms_owner ON gyms (owner_user_id);
CREATE INDEX idx_gyms_location ON gyms USING gist (location);
CREATE INDEX idx_gyms_name_trgm ON gyms USING gin (name gin_trgm_ops);
CREATE INDEX idx_gyms_name_ar_trgm ON gyms USING gin (name_ar gin_trgm_ops) WHERE name_ar IS NOT NULL;

-- Now add the deferred FK from clients to gyms
ALTER TABLE clients
  ADD CONSTRAINT fk_clients_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 12: gym_memberships [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE gym_memberships (
  id           UUID        NOT NULL DEFAULT uuid_v7(),
  pt_user_id   UUID        NOT NULL,
  gym_id       UUID        NOT NULL,
  state        VARCHAR(20) NOT NULL DEFAULT 'invited',
  initiated_by VARCHAR(10) NOT NULL,
  joined_at    TIMESTAMPTZ,
  left_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_gym_memberships PRIMARY KEY (id),
  CONSTRAINT fk_gm_pt FOREIGN KEY (pt_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_gm_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE CASCADE,
  CONSTRAINT uq_gm_pt_gym UNIQUE (pt_user_id, gym_id),
  CONSTRAINT chk_gm_state CHECK (state IN ('invited', 'requested', 'active', 'left')),
  CONSTRAINT chk_gm_initiated_by CHECK (initiated_by IN ('gym', 'pt'))
);

CREATE INDEX idx_gm_gym_state ON gym_memberships (gym_id, state);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 13: gym_clients [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE gym_clients (
  id            UUID         NOT NULL DEFAULT uuid_v7(),
  gym_id        UUID         NOT NULL,
  client_name   VARCHAR(200) NOT NULL,
  contact_email CITEXT,
  contact_phone VARCHAR(20),
  notes         TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_gym_clients PRIMARY KEY (id),
  CONSTRAINT fk_gc_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE CASCADE
);

CREATE INDEX idx_gc_gym ON gym_clients (gym_id) WHERE is_active = TRUE;


-- =============================================================================
-- DOMAIN 5: PROGRAMMING (6 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 14: exercises [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE exercises (
  id                UUID         NOT NULL DEFAULT uuid_v7(),
  name              VARCHAR(200) NOT NULL,
  name_ar           VARCHAR(200),
  slug              VARCHAR(200),
  muscle_group      VARCHAR(30)  NOT NULL,
  equipment         VARCHAR(30)  NOT NULL DEFAULT 'bodyweight',
  movement_pattern  VARCHAR(30)  NOT NULL,
  difficulty        VARCHAR(20),
  instructions      TEXT,
  coaching_cues     TEXT[]       NOT NULL DEFAULT '{}',
  is_custom         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by_user_id UUID,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_exercises PRIMARY KEY (id),
  CONSTRAINT fk_exercises_creator FOREIGN KEY (created_by_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT uq_exercises_slug UNIQUE (slug),
  CONSTRAINT chk_exercises_muscle_group CHECK (muscle_group IN (
    'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
    'quadriceps', 'hamstrings', 'glutes', 'calves', 'abs', 'obliques',
    'traps', 'lats', 'hip_flexors', 'adductors', 'abductors',
    'full_body', 'cardio', 'other'
  )),
  CONSTRAINT chk_exercises_equipment CHECK (equipment IN (
    'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable',
    'bodyweight', 'resistance_band', 'smith_machine', 'trx',
    'medicine_ball', 'foam_roller', 'bench', 'pull_up_bar',
    'cardio_machine', 'other', 'none'
  )),
  CONSTRAINT chk_exercises_movement CHECK (movement_pattern IN (
    'push', 'pull', 'squat', 'hinge', 'lunge', 'carry',
    'rotation', 'isometric', 'plyometric', 'cardio', 'stretch', 'other'
  )),
  CONSTRAINT chk_exercises_difficulty CHECK (difficulty IS NULL OR difficulty IN (
    'beginner', 'intermediate', 'advanced'
  ))
);

CREATE INDEX idx_exercises_name_trgm ON exercises USING gin (name gin_trgm_ops);
CREATE INDEX idx_exercises_name_ar_trgm ON exercises USING gin (name_ar gin_trgm_ops) WHERE name_ar IS NOT NULL;
CREATE INDEX idx_exercises_muscle ON exercises (muscle_group) WHERE is_active = TRUE;
CREATE INDEX idx_exercises_custom ON exercises (created_by_user_id) WHERE is_custom = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 15: programs [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE programs (
  id                  UUID        NOT NULL DEFAULT uuid_v7(),
  author_user_id      UUID        NOT NULL,
  client_id           UUID,
  state               VARCHAR(20) NOT NULL DEFAULT 'draft',
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  duration_weeks      SMALLINT    NOT NULL,
  periodization       VARCHAR(30),
  is_template         BOOLEAN     NOT NULL DEFAULT FALSE,
  template_source_id  UUID,
  is_ai_generated     BOOLEAN     NOT NULL DEFAULT FALSE,
  ai_generation_id    UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_programs PRIMARY KEY (id),
  CONSTRAINT fk_programs_author FOREIGN KEY (author_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_programs_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_programs_template FOREIGN KEY (template_source_id)
    REFERENCES programs(id) ON DELETE SET NULL,
  CONSTRAINT chk_programs_state CHECK (state IN ('draft', 'active', 'completed', 'archived')),
  CONSTRAINT chk_programs_duration CHECK (duration_weeks >= 1 AND duration_weeks <= 52),
  CONSTRAINT chk_programs_periodization CHECK (periodization IS NULL OR periodization IN (
    'linear', 'undulating', 'block', 'conjugate', 'custom'
  ))
  -- ai_generation_id FK added after ai_generations table
);

CREATE INDEX idx_programs_author ON programs (author_user_id);
CREATE INDEX idx_programs_client ON programs (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_programs_template ON programs (is_template) WHERE is_template = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 16: program_weeks [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE program_weeks (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  program_id  UUID        NOT NULL,
  week_number SMALLINT    NOT NULL,
  label       VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_program_weeks PRIMARY KEY (id),
  CONSTRAINT fk_pw_program FOREIGN KEY (program_id)
    REFERENCES programs(id) ON DELETE CASCADE,
  CONSTRAINT uq_pw_program_week UNIQUE (program_id, week_number),
  CONSTRAINT chk_pw_week CHECK (week_number >= 1 AND week_number <= 52)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 17: program_days [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE program_days (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  week_id     UUID        NOT NULL,
  day_number  SMALLINT    NOT NULL,
  label       VARCHAR(100),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_program_days PRIMARY KEY (id),
  CONSTRAINT fk_pd_week FOREIGN KEY (week_id)
    REFERENCES program_weeks(id) ON DELETE CASCADE,
  CONSTRAINT uq_pd_week_day UNIQUE (week_id, day_number),
  CONSTRAINT chk_pd_day CHECK (day_number >= 1 AND day_number <= 7)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 18: program_blocks [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE program_blocks (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  day_id      UUID        NOT NULL,
  sort_order  SMALLINT    NOT NULL DEFAULT 0,
  block_type  VARCHAR(20) NOT NULL DEFAULT 'working',
  label       VARCHAR(100),
  rest_between_sec SMALLINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_program_blocks PRIMARY KEY (id),
  CONSTRAINT fk_pb_day FOREIGN KEY (day_id)
    REFERENCES program_days(id) ON DELETE CASCADE,
  CONSTRAINT chk_pb_block_type CHECK (block_type IN (
    'warmup', 'working', 'cooldown', 'superset', 'circuit',
    'straight', 'emom', 'amrap', 'drop_set'
  ))
);

CREATE INDEX idx_pb_day ON program_blocks (day_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 19: program_exercises [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE program_exercises (
  id                     UUID          NOT NULL DEFAULT uuid_v7(),
  block_id               UUID          NOT NULL,
  exercise_id            UUID          NOT NULL,
  sort_order             SMALLINT      NOT NULL DEFAULT 0,
  target_sets            SMALLINT,
  target_reps_min        SMALLINT,
  target_reps_max        SMALLINT,
  target_weight_kg       NUMERIC(7, 2),
  target_rpe             NUMERIC(3, 1),
  rest_sec               SMALLINT,
  tempo_prescribed       VARCHAR(20),
  prescribed_duration_sec SMALLINT,
  prescribed_distance_m  NUMERIC(8, 2),
  notes                  TEXT,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_program_exercises PRIMARY KEY (id),
  CONSTRAINT fk_pe_block FOREIGN KEY (block_id)
    REFERENCES program_blocks(id) ON DELETE CASCADE,
  CONSTRAINT fk_pe_exercise FOREIGN KEY (exercise_id)
    REFERENCES exercises(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pe_rpe CHECK (target_rpe IS NULL OR (target_rpe >= 1 AND target_rpe <= 10)),
  CONSTRAINT chk_pe_reps CHECK (
    target_reps_min IS NULL OR target_reps_max IS NULL
    OR target_reps_min <= target_reps_max
  )
);

CREATE INDEX idx_pe_block ON program_exercises (block_id, sort_order);
CREATE INDEX idx_pe_exercise ON program_exercises (exercise_id);


-- =============================================================================
-- DOMAIN 6: LOGGING & SESSIONS (5 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 20: workout_sessions [v1]
-- Note: booking_id FK added after bookings table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE workout_sessions (
  id                UUID        NOT NULL DEFAULT uuid_v7(),
  client_id         UUID        NOT NULL,
  logged_by_user_id UUID        NOT NULL,
  program_day_id    UUID,
  booking_id        UUID,
  gym_id            UUID,
  status            VARCHAR(20) NOT NULL DEFAULT 'programmed',
  scheduled_date    DATE,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_min      SMALLINT,
  rating            SMALLINT,
  session_notes     TEXT,
  pt_notes          TEXT,
  is_pt_led         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_workout_sessions PRIMARY KEY (id),
  CONSTRAINT fk_ws_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_ws_logged_by FOREIGN KEY (logged_by_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ws_program_day FOREIGN KEY (program_day_id)
    REFERENCES program_days(id) ON DELETE SET NULL,
  CONSTRAINT fk_ws_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE SET NULL,
  CONSTRAINT chk_ws_status CHECK (status IN (
    'programmed', 'today', 'in_progress', 'completed', 'reviewed', 'skipped'
  )),
  CONSTRAINT chk_ws_rating CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
  -- booking_id FK deferred
);

-- Unique partial index: one workout per booking
CREATE UNIQUE INDEX uq_ws_booking ON workout_sessions (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_ws_client_date ON workout_sessions (client_id, scheduled_date DESC);
CREATE INDEX idx_ws_logged_by ON workout_sessions (logged_by_user_id, status, scheduled_date DESC);
CREATE INDEX idx_ws_status ON workout_sessions (status) WHERE status NOT IN ('completed', 'reviewed', 'skipped');

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 21: sets [v1] — PARTITIONED, ULID PK
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sets (
  id                  CHAR(26)       NOT NULL,  -- ULID, client-generated
  workout_session_id  UUID           NOT NULL,  -- app-enforced FK -> workout_sessions.id
  exercise_id         UUID           NOT NULL,  -- app-enforced FK -> exercises.id
  set_number          SMALLINT       NOT NULL,
  weight_kg           NUMERIC(7, 2),
  reps                SMALLINT,
  rpe                 NUMERIC(3, 1),
  distance_m          NUMERIC(10, 2),
  duration_sec        SMALLINT,
  tempo_actual        VARCHAR(20),
  is_warmup           BOOLEAN        NOT NULL DEFAULT FALSE,
  is_drop_set         BOOLEAN        NOT NULL DEFAULT FALSE,
  is_failure          BOOLEAN        NOT NULL DEFAULT FALSE,
  is_synced           BOOLEAN        NOT NULL DEFAULT FALSE,
  synced_at           TIMESTAMPTZ,
  conflict_resolved   BOOLEAN        NOT NULL DEFAULT FALSE,
  device_id           VARCHAR(100),
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_sets PRIMARY KEY (id, created_at),
  CONSTRAINT chk_sets_rpe CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  CONSTRAINT chk_sets_id_ulid CHECK (LENGTH(id) = 26)
) PARTITION BY RANGE (created_at);

-- Create initial monthly partitions
CREATE TABLE sets_2026_05 PARTITION OF sets
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE sets_2026_06 PARTITION OF sets
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE sets_2026_07 PARTITION OF sets
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE sets_2026_08 PARTITION OF sets
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE sets_2026_09 PARTITION OF sets
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE sets_2026_10 PARTITION OF sets
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- FKs are app-enforced (partitioning limitation)
-- workout_session_id -> workout_sessions.id
-- exercise_id -> exercises.id

CREATE INDEX idx_sets_session ON sets (workout_session_id, set_number);
CREATE INDEX idx_sets_exercise ON sets (exercise_id, created_at DESC);
CREATE INDEX idx_sets_unsynced ON sets (is_synced, created_at) WHERE is_synced = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 22: exercise_prs [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE exercise_prs (
  id          UUID           NOT NULL DEFAULT uuid_v7(),
  client_id   UUID           NOT NULL,
  exercise_id UUID           NOT NULL,
  pr_type     VARCHAR(10)    NOT NULL,
  value       NUMERIC(10, 2) NOT NULL,
  set_id      CHAR(26),      -- ULID ref, app-enforced
  achieved_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_exercise_prs PRIMARY KEY (id),
  CONSTRAINT fk_epr_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_epr_exercise FOREIGN KEY (exercise_id)
    REFERENCES exercises(id) ON DELETE CASCADE,
  CONSTRAINT chk_epr_type CHECK (pr_type IN ('weight', 'reps', 'volume'))
);

CREATE INDEX idx_epr_client_exercise ON exercise_prs (client_id, exercise_id, pr_type, achieved_at DESC);
CREATE INDEX idx_epr_exercise ON exercise_prs (exercise_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 23: body_metrics [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE body_metrics (
  id              UUID           NOT NULL DEFAULT uuid_v7(),
  client_id       UUID           NOT NULL,
  weight_kg       NUMERIC(5, 2),
  body_fat_pct    NUMERIC(4, 1),
  circumferences  JSONB,
  source          VARCHAR(20)    NOT NULL DEFAULT 'manual',
  measured_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_body_metrics PRIMARY KEY (id),
  CONSTRAINT fk_bm_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT chk_bm_source CHECK (source IN ('manual', 'smart_scale')),
  CONSTRAINT chk_bm_weight CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg < 500)),
  CONSTRAINT chk_bm_fat CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 0 AND body_fat_pct <= 100))
);

CREATE INDEX idx_bm_client_date ON body_metrics (client_id, measured_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 24: progress_photos [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE progress_photos (
  id                UUID        NOT NULL DEFAULT uuid_v7(),
  client_id         UUID        NOT NULL,
  photo_url         TEXT        NOT NULL,
  thumbnail_url     TEXT,
  encryption_key_id VARCHAR(100) NOT NULL,
  pose_type         VARCHAR(20),
  is_shared_with_pt BOOLEAN     NOT NULL DEFAULT FALSE,
  taken_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_progress_photos PRIMARY KEY (id),
  CONSTRAINT fk_pp_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT chk_pp_pose CHECK (pose_type IS NULL OR pose_type IN (
    'front', 'back', 'side_left', 'side_right', 'custom'
  ))
);

CREATE INDEX idx_pp_client_date ON progress_photos (client_id, taken_at DESC);


-- =============================================================================
-- DOMAIN 7: NUTRITION (3 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 25: meal_plans [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE meal_plans (
  id               UUID           NOT NULL DEFAULT uuid_v7(),
  client_id        UUID           NOT NULL,
  author_user_id   UUID           NOT NULL,
  name             VARCHAR(200)   NOT NULL,
  target_calories  SMALLINT,
  target_protein_g SMALLINT,
  target_carbs_g   SMALLINT,
  target_fat_g     SMALLINT,
  meals            JSONB          NOT NULL DEFAULT '[]',
  state            VARCHAR(20)    NOT NULL DEFAULT 'draft',
  is_ai_generated  BOOLEAN        NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_meal_plans PRIMARY KEY (id),
  CONSTRAINT fk_mp_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_mp_author FOREIGN KEY (author_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_mp_state CHECK (state IN ('draft', 'active', 'archived')),
  CONSTRAINT chk_mp_calories CHECK (target_calories IS NULL OR target_calories > 0)
);

CREATE INDEX idx_mp_client ON meal_plans (client_id, state);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 26: food_items [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE food_items (
  id                   UUID           NOT NULL DEFAULT uuid_v7(),
  name                 VARCHAR(300)   NOT NULL,
  name_ar              VARCHAR(300),
  barcode              VARCHAR(50),
  brand                VARCHAR(200),
  serving_size_g       NUMERIC(7, 2)  NOT NULL DEFAULT 100,
  calories_per_serving NUMERIC(7, 2)  NOT NULL,
  protein_g            NUMERIC(6, 2)  NOT NULL DEFAULT 0,
  carbs_g              NUMERIC(6, 2)  NOT NULL DEFAULT 0,
  fat_g                NUMERIC(6, 2)  NOT NULL DEFAULT 0,
  fiber_g              NUMERIC(6, 2),
  source               VARCHAR(30)    NOT NULL DEFAULT 'custom',
  is_verified          BOOLEAN        NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_food_items PRIMARY KEY (id),
  CONSTRAINT chk_fi_source CHECK (source IN ('usda', 'openfoodfacts', 'custom', 'user_submitted')),
  CONSTRAINT chk_fi_serving CHECK (serving_size_g > 0),
  CONSTRAINT chk_fi_calories CHECK (calories_per_serving >= 0)
);

CREATE UNIQUE INDEX uq_fi_barcode ON food_items (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_fi_name_trgm ON food_items USING gin (name gin_trgm_ops);
CREATE INDEX idx_fi_name_ar_trgm ON food_items USING gin (name_ar gin_trgm_ops) WHERE name_ar IS NOT NULL;
CREATE INDEX idx_fi_barcode ON food_items (barcode) WHERE barcode IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 27: food_logs [v1] — PARTITIONED
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE food_logs (
  id            UUID           NOT NULL DEFAULT uuid_v7(),
  client_id     UUID           NOT NULL,   -- app-enforced FK -> clients.id
  food_item_id  UUID,                      -- app-enforced FK -> food_items.id
  meal_plan_id  UUID,                      -- app-enforced FK -> meal_plans.id
  meal_type     VARCHAR(10)    NOT NULL,
  custom_name   VARCHAR(300),
  servings      NUMERIC(5, 2)  NOT NULL DEFAULT 1,
  calories      NUMERIC(7, 2),
  protein_g     NUMERIC(6, 2),
  carbs_g       NUMERIC(6, 2),
  fat_g         NUMERIC(6, 2),
  source        VARCHAR(20)    NOT NULL DEFAULT 'manual',
  logged_date   DATE           NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_food_logs PRIMARY KEY (id, logged_date),
  CONSTRAINT chk_fl_meal_type CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  CONSTRAINT chk_fl_source CHECK (source IN ('manual', 'barcode', 'ai_suggestion')),
  CONSTRAINT chk_fl_servings CHECK (servings > 0)
) PARTITION BY RANGE (logged_date);

-- Create initial monthly partitions
CREATE TABLE food_logs_2026_05 PARTITION OF food_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE food_logs_2026_06 PARTITION OF food_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE food_logs_2026_07 PARTITION OF food_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE food_logs_2026_08 PARTITION OF food_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE food_logs_2026_09 PARTITION OF food_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE food_logs_2026_10 PARTITION OF food_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE INDEX idx_fl_client_date ON food_logs (client_id, logged_date DESC);
CREATE INDEX idx_fl_food_item ON food_logs (food_item_id) WHERE food_item_id IS NOT NULL;


-- =============================================================================
-- DOMAIN 8: SCHEDULING & BOOKINGS (4 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 28: schedules [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE schedules (
  id              UUID        NOT NULL DEFAULT uuid_v7(),
  user_id         UUID        NOT NULL,
  day_of_week     SMALLINT    NOT NULL,
  start_time      TIME        NOT NULL,
  end_time        TIME        NOT NULL,
  slot_duration_min SMALLINT  NOT NULL DEFAULT 60,
  timezone        VARCHAR(50) NOT NULL DEFAULT 'Asia/Beirut',
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  gym_id          UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_schedules PRIMARY KEY (id),
  CONSTRAINT fk_sched_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sched_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE SET NULL,
  CONSTRAINT chk_sched_dow CHECK (day_of_week >= 0 AND day_of_week <= 6),
  CONSTRAINT chk_sched_times CHECK (end_time > start_time),
  CONSTRAINT chk_sched_slot CHECK (slot_duration_min IN (30, 45, 60, 90, 120))
);

CREATE INDEX idx_sched_user_day ON schedules (user_id, day_of_week) WHERE is_active = TRUE;
CREATE INDEX idx_sched_gym ON schedules (gym_id) WHERE gym_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 31: classes [v2]
-- (Created before bookings because bookings references it)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE classes (
  id                UUID         NOT NULL DEFAULT uuid_v7(),
  pt_user_id        UUID         NOT NULL,
  gym_id            UUID,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  capacity          SMALLINT     NOT NULL,
  waitlist_capacity SMALLINT     NOT NULL DEFAULT 0,
  duration_min      SMALLINT     NOT NULL DEFAULT 60,
  recurring_rule    VARCHAR(255),
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_classes PRIMARY KEY (id),
  CONSTRAINT fk_classes_pt FOREIGN KEY (pt_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_classes_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE SET NULL,
  CONSTRAINT chk_classes_capacity CHECK (capacity >= 2 AND capacity <= 100),
  CONSTRAINT chk_classes_waitlist CHECK (waitlist_capacity >= 0)
);

CREATE INDEX idx_classes_pt ON classes (pt_user_id) WHERE is_active = TRUE;
CREATE INDEX idx_classes_gym ON classes (gym_id) WHERE gym_id IS NOT NULL AND is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 29: bookings [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE bookings (
  id                   UUID         NOT NULL DEFAULT uuid_v7(),
  pt_user_id           UUID         NOT NULL,
  client_id            UUID,
  class_id             UUID,
  gym_id               UUID,
  schedule_id          UUID,
  status               VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  starts_at            TIMESTAMPTZ  NOT NULL,
  ends_at              TIMESTAMPTZ  NOT NULL,
  originating_timezone VARCHAR(50)  NOT NULL DEFAULT 'Asia/Beirut',
  recurrence_rule      VARCHAR(255),
  parent_booking_id    UUID,
  location_name        VARCHAR(200),
  notes                TEXT,
  cancelled_by         VARCHAR(10),
  cancelled_at         TIMESTAMPTZ,
  reminder_24h_sent    BOOLEAN      NOT NULL DEFAULT FALSE,
  reminder_1h_sent     BOOLEAN      NOT NULL DEFAULT FALSE,
  no_show_marked_at    TIMESTAMPTZ,
  ical_uid             VARCHAR(255),
  google_calendar_id   VARCHAR(255),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_bookings PRIMARY KEY (id),
  CONSTRAINT fk_bookings_pt FOREIGN KEY (pt_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_class FOREIGN KEY (class_id)
    REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_schedule FOREIGN KEY (schedule_id)
    REFERENCES schedules(id) ON DELETE SET NULL,
  CONSTRAINT fk_bookings_parent FOREIGN KEY (parent_booking_id)
    REFERENCES bookings(id) ON DELETE SET NULL,
  CONSTRAINT chk_bookings_status CHECK (status IN (
    'scheduled', 'reminder_sent', 'waitlisted', 'promoted',
    'checked_in', 'in_progress', 'checked_out',
    'completed', 'no_show', 'cancelled'
  )),
  CONSTRAINT chk_bookings_times CHECK (ends_at > starts_at),
  CONSTRAINT chk_bookings_cancelled_by CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'pt', 'system'))
);

CREATE INDEX idx_bookings_pt_date ON bookings (pt_user_id, starts_at);
CREATE INDEX idx_bookings_client_date ON bookings (client_id, starts_at) WHERE client_id IS NOT NULL;
CREATE INDEX idx_bookings_status ON bookings (status) WHERE status NOT IN ('completed', 'cancelled', 'no_show');
CREATE INDEX idx_bookings_gym_date ON bookings (gym_id, starts_at) WHERE gym_id IS NOT NULL;
CREATE INDEX idx_bookings_reminders ON bookings (starts_at, reminder_24h_sent, reminder_1h_sent) WHERE status = 'scheduled';

-- Now add the deferred booking FK on workout_sessions
ALTER TABLE workout_sessions
  ADD CONSTRAINT fk_ws_booking FOREIGN KEY (booking_id)
    REFERENCES bookings(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 30: check_ins [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE check_ins (
  id                   UUID        NOT NULL DEFAULT uuid_v7(),
  booking_id           UUID        NOT NULL,
  check_in_method      VARCHAR(20) NOT NULL,
  checked_in_at        TIMESTAMPTZ NOT NULL,
  checked_out_at       TIMESTAMPTZ,
  rating               SMALLINT,
  feedback_text        TEXT,
  checked_in_by_user_id UUID       NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_check_ins PRIMARY KEY (id),
  CONSTRAINT fk_ci_booking FOREIGN KEY (booking_id)
    REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_ci_user FOREIGN KEY (checked_in_by_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_ci_booking UNIQUE (booking_id),
  CONSTRAINT chk_ci_method CHECK (check_in_method IN ('qr_scan', 'manual', 'geofence')),
  CONSTRAINT chk_ci_rating CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);


-- =============================================================================
-- DOMAIN 9: BILLING & SUBSCRIPTIONS (5 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 32: subscriptions [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE subscriptions (
  id                       UUID         NOT NULL DEFAULT uuid_v7(),
  user_id                  UUID         NOT NULL,
  product                  VARCHAR(30)  NOT NULL,
  status                   VARCHAR(20)  NOT NULL DEFAULT 'trial',
  billing_interval         VARCHAR(10)  NOT NULL DEFAULT 'monthly',
  price_cents              INTEGER      NOT NULL,
  currency                 VARCHAR(3)   NOT NULL DEFAULT 'USD',
  client_cap               SMALLINT,
  sub_pt_seats             SMALLINT,
  payment_method           VARCHAR(20),
  processor_subscription_id VARCHAR(255),
  trial_started_at         TIMESTAMPTZ,
  trial_ends_at            TIMESTAMPTZ,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  renews_at                TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  discount_type            VARCHAR(20),
  discount_pct             SMALLINT,
  discount_expires_at      TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_subscriptions PRIMARY KEY (id),
  CONSTRAINT fk_subs_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_subs_product CHECK (product IN (
    'solo_free_trial', 'solo_pro', 'solo_elite', 'solo_power',
    'master_pro', 'master_elite', 'master_power',
    'client_premium'
  )),
  CONSTRAINT chk_subs_status CHECK (status IN (
    'trial', 'active', 'past_due', 'cancelled', 'reactivated', 'tier_changed'
  )),
  CONSTRAINT chk_subs_interval CHECK (billing_interval IN ('monthly', 'annual')),
  CONSTRAINT chk_subs_currency CHECK (currency IN ('USD', 'AED')),
  CONSTRAINT chk_subs_payment CHECK (payment_method IS NULL OR payment_method IN (
    'whish', 'areeba', 'stripe', 'apple_iap', 'google_iap'
  )),
  CONSTRAINT chk_subs_discount_type CHECK (discount_type IS NULL OR discount_type IN (
    'founding_member', 'educational'
  )),
  CONSTRAINT chk_subs_discount_pct CHECK (discount_pct IS NULL OR (discount_pct > 0 AND discount_pct <= 100)),
  CONSTRAINT chk_subs_price CHECK (price_cents >= 0)
);

CREATE INDEX idx_subs_user_status ON subscriptions (user_id, status);
CREATE INDEX idx_subs_renews ON subscriptions (renews_at) WHERE status IN ('active', 'past_due');
CREATE INDEX idx_subs_trial_ends ON subscriptions (trial_ends_at) WHERE status = 'trial';
CREATE INDEX idx_subs_processor ON subscriptions (processor_subscription_id)
  WHERE processor_subscription_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 33: subscription_addons [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE subscription_addons (
  id              UUID        NOT NULL DEFAULT uuid_v7(),
  subscription_id UUID        NOT NULL,
  addon_type      VARCHAR(20) NOT NULL,
  quantity        SMALLINT    NOT NULL DEFAULT 1,
  price_cents     INTEGER     NOT NULL,
  currency        VARCHAR(3)  NOT NULL DEFAULT 'USD',
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_subscription_addons PRIMARY KEY (id),
  CONSTRAINT fk_sa_sub FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT chk_sa_type CHECK (addon_type IN ('client_pack', 'sub_pt_seat')),
  CONSTRAINT chk_sa_quantity CHECK (quantity >= 1),
  CONSTRAINT chk_sa_currency CHECK (currency IN ('USD', 'AED')),
  CONSTRAINT chk_sa_price CHECK (price_cents > 0)
);

CREATE INDEX idx_sa_sub_active ON subscription_addons (subscription_id) WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 34: charges [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE charges (
  id                UUID        NOT NULL DEFAULT uuid_v7(),
  subscription_id   UUID,
  user_id           UUID        NOT NULL,
  amount_cents      INTEGER     NOT NULL,
  currency          VARCHAR(3)  NOT NULL DEFAULT 'USD',
  payment_method    VARCHAR(20) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',
  processor_ref     VARCHAR(255),
  processor_fee_cents INTEGER,
  description       VARCHAR(255),
  failure_reason    TEXT,
  refunded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_charges PRIMARY KEY (id),
  CONSTRAINT fk_charges_sub FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id) ON DELETE SET NULL,
  CONSTRAINT fk_charges_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_charges_amount CHECK (amount_cents > 0),
  CONSTRAINT chk_charges_currency CHECK (currency IN ('USD', 'AED')),
  CONSTRAINT chk_charges_method CHECK (payment_method IN (
    'whish', 'areeba', 'stripe', 'apple_iap', 'google_iap', 'apple_pay', 'google_pay'
  )),
  CONSTRAINT chk_charges_status CHECK (status IN (
    'pending', 'processing', 'succeeded', 'failed', 'refunded', 'disputed'
  ))
);

CREATE INDEX idx_charges_sub ON charges (subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX idx_charges_user_status ON charges (user_id, status);
CREATE INDEX idx_charges_processor ON charges (processor_ref) WHERE processor_ref IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 35: ai_credit_wallets [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ai_credit_wallets (
  id                 UUID        NOT NULL DEFAULT uuid_v7(),
  user_id            UUID        NOT NULL,
  balance            INTEGER     NOT NULL DEFAULT 0,
  total_purchased    INTEGER     NOT NULL DEFAULT 0,
  total_consumed     INTEGER     NOT NULL DEFAULT 0,
  total_refunded     INTEGER     NOT NULL DEFAULT 0,
  low_balance_warned_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_ai_credit_wallets PRIMARY KEY (id),
  CONSTRAINT fk_acw_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_acw_user UNIQUE (user_id),
  CONSTRAINT chk_acw_balance CHECK (balance >= 0)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 36: ai_credit_packs [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ai_credit_packs (
  id              UUID        NOT NULL DEFAULT uuid_v7(),
  wallet_id       UUID        NOT NULL,
  charge_id       UUID,
  tier            VARCHAR(20) NOT NULL,
  credits         SMALLINT    NOT NULL,
  price_cents     INTEGER     NOT NULL,
  currency        VARCHAR(3)  NOT NULL DEFAULT 'USD',
  purchase_channel VARCHAR(10) NOT NULL,
  purchased_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_ai_credit_packs PRIMARY KEY (id),
  CONSTRAINT fk_acp_wallet FOREIGN KEY (wallet_id)
    REFERENCES ai_credit_wallets(id) ON DELETE CASCADE,
  CONSTRAINT fk_acp_charge FOREIGN KEY (charge_id)
    REFERENCES charges(id) ON DELETE SET NULL,
  CONSTRAINT chk_acp_tier CHECK (tier IN ('starter', 'standard', 'power', 'mega')),
  CONSTRAINT chk_acp_channel CHECK (purchase_channel IN ('mobile_iap', 'web')),
  CONSTRAINT chk_acp_currency CHECK (currency IN ('USD', 'AED'))
);

CREATE INDEX idx_acp_wallet ON ai_credit_packs (wallet_id);
CREATE INDEX idx_acp_charge ON ai_credit_packs (charge_id) WHERE charge_id IS NOT NULL;


-- =============================================================================
-- DOMAIN 10: AI (1 table)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 37: ai_generations [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ai_generations (
  id                UUID        NOT NULL DEFAULT uuid_v7(),
  user_id           UUID        NOT NULL,
  generation_type   VARCHAR(30) NOT NULL,
  prompt_hash       VARCHAR(64) NOT NULL,
  prompt_scrubbed   TEXT,
  output_scrubbed   TEXT,
  model_id          VARCHAR(100) NOT NULL,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  latency_ms        INTEGER,
  credits_charged   SMALLINT    NOT NULL DEFAULT 1,
  was_refunded      BOOLEAN     NOT NULL DEFAULT FALSE,
  refund_reason     TEXT,
  result_entity_type VARCHAR(30),
  result_entity_id  UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_ai_generations PRIMARY KEY (id),
  CONSTRAINT fk_aigen_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_aigen_type CHECK (generation_type IN (
    'program_draft', 'meal_plan', 'monthly_recap', 'workout_suggestion'
  ))
);

CREATE INDEX idx_aigen_user ON ai_generations (user_id, created_at DESC);
CREATE INDEX idx_aigen_type ON ai_generations (generation_type, created_at DESC);
CREATE INDEX idx_aigen_refunded ON ai_generations (was_refunded) WHERE was_refunded = TRUE;

-- Now add the deferred FK from programs to ai_generations
ALTER TABLE programs
  ADD CONSTRAINT fk_programs_ai_gen FOREIGN KEY (ai_generation_id)
    REFERENCES ai_generations(id) ON DELETE SET NULL;


-- =============================================================================
-- DOMAIN 11: COMMUNICATION (3 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 38: messages [v1/v2]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id                    UUID        NOT NULL DEFAULT uuid_v7(),
  sender_user_id        UUID        NOT NULL,
  message_type          VARCHAR(20) NOT NULL DEFAULT 'announcement',
  body                  TEXT        NOT NULL,
  media_url             TEXT,
  media_type            VARCHAR(20),
  media_duration_sec    SMALLINT,
  voice_transcript      TEXT,
  thread_id             UUID,
  is_edited             BOOLEAN     NOT NULL DEFAULT FALSE,
  edited_at             TIMESTAMPTZ,
  edit_window_closes_at TIMESTAMPTZ,
  is_deleted            BOOLEAN     NOT NULL DEFAULT FALSE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_messages PRIMARY KEY (id),
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_thread FOREIGN KEY (thread_id)
    REFERENCES messages(id) ON DELETE SET NULL,
  CONSTRAINT chk_msg_type CHECK (message_type IN ('announcement', 'direct', 'voice_note')),
  CONSTRAINT chk_msg_media_type CHECK (media_type IS NULL OR media_type IN (
    'image', 'voice_note', 'video', 'file'
  )),
  CONSTRAINT chk_msg_body_length CHECK (
    message_type != 'announcement' OR LENGTH(body) <= 500
  )
);

CREATE INDEX idx_msg_sender ON messages (sender_user_id, created_at DESC);
CREATE INDEX idx_msg_thread ON messages (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_msg_type ON messages (message_type, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 39: message_recipients [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE message_recipients (
  id               UUID        NOT NULL DEFAULT uuid_v7(),
  message_id       UUID        NOT NULL,
  recipient_user_id UUID       NOT NULL,
  is_read          BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_message_recipients PRIMARY KEY (id),
  CONSTRAINT fk_mr_message FOREIGN KEY (message_id)
    REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_mr_recipient FOREIGN KEY (recipient_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_mr_message_recipient UNIQUE (message_id, recipient_user_id)
);

CREATE INDEX idx_mr_recipient_unread ON message_recipients (recipient_user_id)
  WHERE is_read = FALSE;
CREATE INDEX idx_mr_message ON message_recipients (message_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 40: video_sessions [v2]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE video_sessions (
  id               UUID         NOT NULL DEFAULT uuid_v7(),
  booking_id       UUID         NOT NULL,
  provider         VARCHAR(20)  NOT NULL,
  room_id          VARCHAR(255) NOT NULL,
  room_url         TEXT         NOT NULL,
  max_participants SMALLINT     NOT NULL DEFAULT 2,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_minutes SMALLINT,
  recording_url    TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_video_sessions PRIMARY KEY (id),
  CONSTRAINT fk_vs_booking FOREIGN KEY (booking_id)
    REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT uq_vs_booking UNIQUE (booking_id),
  CONSTRAINT chk_vs_provider CHECK (provider IN ('livekit', 'daily')),
  CONSTRAINT chk_vs_participants CHECK (max_participants >= 2 AND max_participants <= 12)
);


-- =============================================================================
-- DOMAIN 12: FORM-CHECK VIDEO REVIEW (2 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 41: form_check_uploads [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE form_check_uploads (
  id                  UUID        NOT NULL DEFAULT uuid_v7(),
  client_id           UUID        NOT NULL,
  exercise_id         UUID,
  video_url           TEXT        NOT NULL,
  thumbnail_url       TEXT,
  duration_sec        SMALLINT    NOT NULL,
  file_size_bytes     INTEGER     NOT NULL,
  upload_status       VARCHAR(20) NOT NULL DEFAULT 'uploading',
  review_status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by_user_id UUID,
  reviewed_at         TIMESTAMPTZ,
  encryption_key_id   VARCHAR(100) NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_form_check_uploads PRIMARY KEY (id),
  CONSTRAINT fk_fcu_client FOREIGN KEY (client_id)
    REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_fcu_exercise FOREIGN KEY (exercise_id)
    REFERENCES exercises(id) ON DELETE SET NULL,
  CONSTRAINT fk_fcu_reviewer FOREIGN KEY (reviewed_by_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_fcu_duration CHECK (duration_sec <= 30),
  CONSTRAINT chk_fcu_filesize CHECK (file_size_bytes <= 209715200),  -- 200MB
  CONSTRAINT chk_fcu_upload_status CHECK (upload_status IN (
    'uploading', 'processing', 'ready', 'failed'
  )),
  CONSTRAINT chk_fcu_review_status CHECK (review_status IN (
    'pending', 'in_review', 'reviewed'
  ))
);

CREATE INDEX idx_fcu_client ON form_check_uploads (client_id, created_at DESC);
CREATE INDEX idx_fcu_pending ON form_check_uploads (review_status) WHERE review_status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 42: form_check_comments [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE form_check_comments (
  id               UUID        NOT NULL DEFAULT uuid_v7(),
  upload_id        UUID        NOT NULL,
  author_user_id   UUID        NOT NULL,
  timestamp_ms     INTEGER     NOT NULL,
  body             TEXT        NOT NULL,
  drawing_data     JSONB,
  parent_comment_id UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_form_check_comments PRIMARY KEY (id),
  CONSTRAINT fk_fcc_upload FOREIGN KEY (upload_id)
    REFERENCES form_check_uploads(id) ON DELETE CASCADE,
  CONSTRAINT fk_fcc_author FOREIGN KEY (author_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fcc_parent FOREIGN KEY (parent_comment_id)
    REFERENCES form_check_comments(id) ON DELETE SET NULL,
  CONSTRAINT chk_fcc_timestamp CHECK (timestamp_ms >= 0)
);

CREATE INDEX idx_fcc_upload_ts ON form_check_comments (upload_id, timestamp_ms);


-- =============================================================================
-- DOMAIN 13: NOTIFICATIONS (2 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 43: notifications [v1] — PARTITIONED
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id            UUID        NOT NULL DEFAULT uuid_v7(),
  user_id       UUID        NOT NULL,  -- app-enforced FK -> users.id
  channel       VARCHAR(10) NOT NULL,
  category      VARCHAR(30) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  body          TEXT        NOT NULL,
  deep_link     TEXT,
  is_read       BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  is_delivered  BOOLEAN     NOT NULL DEFAULT FALSE,
  delivered_at  TIMESTAMPTZ,
  delivery_error TEXT,
  is_suppressed BOOLEAN     NOT NULL DEFAULT FALSE,
  entity_type   VARCHAR(50),
  entity_id     UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_notifications PRIMARY KEY (id, created_at),
  CONSTRAINT chk_notif_channel CHECK (channel IN ('push', 'email', 'sms', 'in_app')),
  CONSTRAINT chk_notif_category CHECK (category IN (
    'session_reminder', 'checkin', 'billing', 'streak', 'pr',
    'nudge', 'form_check', 'intake', 'announcement', 'challenge',
    'badge', 'system', 'marketing'
  ))
) PARTITION BY RANGE (created_at);

-- Create initial monthly partitions
CREATE TABLE notifications_2026_05 PARTITION OF notifications
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE notifications_2026_06 PARTITION OF notifications
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE notifications_2026_07 PARTITION OF notifications
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE notifications_2026_08 PARTITION OF notifications
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE notifications_2026_09 PARTITION OF notifications
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE notifications_2026_10 PARTITION OF notifications
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE INDEX idx_notif_user_unread ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX idx_notif_user_category ON notifications (user_id, category);
CREATE INDEX idx_notif_delivery ON notifications (is_delivered, created_at) WHERE is_delivered = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 44: notification_preferences [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE notification_preferences (
  id          UUID        NOT NULL DEFAULT uuid_v7(),
  user_id     UUID        NOT NULL,
  channel     VARCHAR(10) NOT NULL,
  category    VARCHAR(30) NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  quiet_start TIME,
  quiet_end   TIME,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_notification_preferences PRIMARY KEY (id),
  CONSTRAINT fk_np_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_np_user_channel_cat UNIQUE (user_id, channel, category),
  CONSTRAINT chk_np_channel CHECK (channel IN ('push', 'email', 'sms', 'in_app')),
  CONSTRAINT chk_np_category CHECK (category IN (
    'session_reminder', 'checkin', 'billing', 'streak', 'pr',
    'nudge', 'form_check', 'intake', 'announcement', 'challenge',
    'badge', 'system', 'marketing'
  ))
);


-- =============================================================================
-- DOMAIN 14: GAMIFICATION (5 tables)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 45: streaks [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE streaks (
  id                UUID        NOT NULL DEFAULT uuid_v7(),
  user_id           UUID        NOT NULL,
  streak_type       VARCHAR(20) NOT NULL,
  current_count     INTEGER     NOT NULL DEFAULT 0,
  longest_count     INTEGER     NOT NULL DEFAULT 0,
  last_activity_date DATE,
  freeze_remaining  SMALLINT    NOT NULL DEFAULT 1,
  frozen_until      DATE,
  started_at        DATE,
  broken_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_streaks PRIMARY KEY (id),
  CONSTRAINT fk_streaks_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_streaks_user_type UNIQUE (user_id, streak_type),
  CONSTRAINT chk_streaks_type CHECK (streak_type IN ('logging', 'macros', 'sessions')),
  CONSTRAINT chk_streaks_count CHECK (current_count >= 0),
  CONSTRAINT chk_streaks_longest CHECK (longest_count >= 0)
);

CREATE INDEX idx_streaks_user ON streaks (user_id);
CREATE INDEX idx_streaks_daily ON streaks (last_activity_date) WHERE current_count > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 46: badges [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE badges (
  id          UUID         NOT NULL DEFAULT uuid_v7(),
  slug        VARCHAR(50)  NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description TEXT         NOT NULL,
  icon_url    TEXT,
  category    VARCHAR(20)  NOT NULL,
  criteria    JSONB        NOT NULL,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_badges PRIMARY KEY (id),
  CONSTRAINT uq_badges_slug UNIQUE (slug),
  CONSTRAINT chk_badges_category CHECK (category IN (
    'logging', 'strength', 'consistency', 'nutrition', 'milestone'
  ))
);

CREATE INDEX idx_badges_category ON badges (category) WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 47: user_badges [v1]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE user_badges (
  id               UUID        NOT NULL DEFAULT uuid_v7(),
  user_id          UUID        NOT NULL,
  badge_id         UUID        NOT NULL,
  earned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context          JSONB,
  shared_image_url TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_user_badges PRIMARY KEY (id),
  CONSTRAINT fk_ub_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ub_badge FOREIGN KEY (badge_id)
    REFERENCES badges(id) ON DELETE CASCADE,
  CONSTRAINT uq_ub_user_badge UNIQUE (user_id, badge_id)
);

CREATE INDEX idx_ub_user ON user_badges (user_id, earned_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 48: challenges [v1.5]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE challenges (
  id                 UUID           NOT NULL DEFAULT uuid_v7(),
  created_by_user_id UUID           NOT NULL,
  name               VARCHAR(200)   NOT NULL,
  description        TEXT,
  challenge_type     VARCHAR(30)    NOT NULL,
  target_value       NUMERIC(10, 2),
  duration_days      SMALLINT       NOT NULL DEFAULT 30,
  starts_at          TIMESTAMPTZ    NOT NULL,
  ends_at            TIMESTAMPTZ    NOT NULL,
  max_participants   SMALLINT,
  is_active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_challenges PRIMARY KEY (id),
  CONSTRAINT fk_challenges_creator FOREIGN KEY (created_by_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_challenges_type CHECK (challenge_type IN (
    'logging_streak', 'volume_target', 'session_count', 'custom'
  )),
  CONSTRAINT chk_challenges_duration CHECK (duration_days >= 7 AND duration_days <= 90),
  CONSTRAINT chk_challenges_dates CHECK (ends_at > starts_at)
);

CREATE INDEX idx_challenges_active ON challenges (starts_at, ends_at) WHERE is_active = TRUE;
CREATE INDEX idx_challenges_creator ON challenges (created_by_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 49: challenge_participants [v1.5]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE challenge_participants (
  id            UUID           NOT NULL DEFAULT uuid_v7(),
  challenge_id  UUID           NOT NULL,
  user_id       UUID           NOT NULL,
  current_value NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status        VARCHAR(20)    NOT NULL DEFAULT 'active',
  completed_at  TIMESTAMPTZ,
  joined_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_challenge_participants PRIMARY KEY (id),
  CONSTRAINT fk_cp_challenge FOREIGN KEY (challenge_id)
    REFERENCES challenges(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uq_cp_challenge_user UNIQUE (challenge_id, user_id),
  CONSTRAINT chk_cp_status CHECK (status IN ('active', 'completed', 'failed', 'withdrawn'))
);

CREATE INDEX idx_cp_challenge ON challenge_participants (challenge_id, status);
CREATE INDEX idx_cp_user ON challenge_participants (user_id);


-- =============================================================================
-- DOMAIN 15: MARKETPLACE (5 tables, v2/v3)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 50: listings [v2]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE listings (
  id           UUID         NOT NULL DEFAULT uuid_v7(),
  gym_id       UUID,
  user_id      UUID,
  listing_type VARCHAR(30)  NOT NULL,
  title        VARCHAR(200) NOT NULL,
  blurb        TEXT,
  is_published BOOLEAN      NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_listings PRIMARY KEY (id),
  CONSTRAINT fk_listings_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE CASCADE,
  CONSTRAINT fk_listings_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_listings_type CHECK (listing_type IN (
    'gym_seeks_pt', 'pt_seeks_gym', 'gym_public_dir'
  ))
);

CREATE INDEX idx_listings_published ON listings (listing_type) WHERE is_published = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 51: events [v3]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id                 UUID         NOT NULL DEFAULT uuid_v7(),
  gym_id             UUID         NOT NULL,
  created_by_user_id UUID         NOT NULL,
  name               VARCHAR(200) NOT NULL,
  description        TEXT,
  visibility         VARCHAR(20)  NOT NULL,
  ticket_price_cents INTEGER,
  currency           VARCHAR(3),
  capacity           SMALLINT     NOT NULL,
  starts_at          TIMESTAMPTZ  NOT NULL,
  ends_at            TIMESTAMPTZ  NOT NULL,
  location_name      VARCHAR(200),
  cover_image_url    TEXT,
  is_cancelled       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_events PRIMARY KEY (id),
  CONSTRAINT fk_events_gym FOREIGN KEY (gym_id)
    REFERENCES gyms(id) ON DELETE CASCADE,
  CONSTRAINT fk_events_creator FOREIGN KEY (created_by_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_events_visibility CHECK (visibility IN ('private', 'public_free', 'public_paid')),
  CONSTRAINT chk_events_price CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 0),
  CONSTRAINT chk_events_currency CHECK (currency IS NULL OR currency IN ('USD', 'AED')),
  CONSTRAINT chk_events_capacity CHECK (capacity >= 1),
  CONSTRAINT chk_events_dates CHECK (ends_at > starts_at)
);

CREATE INDEX idx_events_gym_date ON events (gym_id, starts_at);
CREATE INDEX idx_events_visibility ON events (visibility, starts_at) WHERE is_cancelled = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 52: tickets [v3]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE tickets (
  id           UUID        NOT NULL DEFAULT uuid_v7(),
  event_id     UUID        NOT NULL,
  user_id      UUID        NOT NULL,
  charge_id    UUID,
  status       VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  ticket_code  VARCHAR(20) NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_tickets PRIMARY KEY (id),
  CONSTRAINT fk_tickets_event FOREIGN KEY (event_id)
    REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tickets_charge FOREIGN KEY (charge_id)
    REFERENCES charges(id) ON DELETE SET NULL,
  CONSTRAINT uq_tickets_code UNIQUE (ticket_code),
  CONSTRAINT chk_tickets_status CHECK (status IN ('confirmed', 'cancelled', 'refunded', 'used'))
);

CREATE INDEX idx_tickets_event ON tickets (event_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 53: products [v3]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE products (
  id             UUID         NOT NULL DEFAULT uuid_v7(),
  name           VARCHAR(200) NOT NULL,
  description    TEXT,
  price_cents    INTEGER      NOT NULL,
  currency       VARCHAR(3)   NOT NULL DEFAULT 'USD',
  image_urls     TEXT[]       NOT NULL DEFAULT '{}',
  category       VARCHAR(50),
  sku            VARCHAR(50)  NOT NULL,
  stock_quantity INTEGER      NOT NULL DEFAULT 0,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_products PRIMARY KEY (id),
  CONSTRAINT uq_products_sku UNIQUE (sku),
  CONSTRAINT chk_products_price CHECK (price_cents > 0),
  CONSTRAINT chk_products_currency CHECK (currency IN ('USD', 'AED')),
  CONSTRAINT chk_products_stock CHECK (stock_quantity >= 0)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table 54: orders [v3]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id                   UUID        NOT NULL DEFAULT uuid_v7(),
  user_id              UUID        NOT NULL,
  charge_id            UUID,
  status               VARCHAR(20) NOT NULL DEFAULT 'cart',
  total_cents          INTEGER     NOT NULL,
  currency             VARCHAR(3)  NOT NULL DEFAULT 'USD',
  shipping_address     JSONB,
  fulfillment_provider VARCHAR(30),
  tracking_number      VARCHAR(100),
  placed_at            TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pk_orders PRIMARY KEY (id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_charge FOREIGN KEY (charge_id)
    REFERENCES charges(id) ON DELETE SET NULL,
  CONSTRAINT chk_orders_status CHECK (status IN (
    'cart', 'placed', 'confirmed', 'out_for_delivery',
    'delivered', 'returned', 'refunded'
  )),
  CONSTRAINT chk_orders_currency CHECK (currency IN ('USD', 'AED'))
);

CREATE INDEX idx_orders_user ON orders (user_id, status);


-- =============================================================================
-- TRIGGERS: updated_at auto-update on all mutable tables
-- =============================================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users', 'user_sessions', 'device_tokens',
      'pt_profiles', 'pt_modes', 'master_sub_relations',
      'clients', 'client_pt_assignments', 'intake_forms',
      'gyms', 'gym_memberships', 'gym_clients',
      'exercises', 'programs', 'program_weeks', 'program_days',
      'program_blocks', 'program_exercises',
      'workout_sessions', 'sets',
      'exercise_prs', 'body_metrics', 'progress_photos',
      'meal_plans', 'food_items', 'food_logs',
      'schedules', 'classes', 'bookings', 'check_ins',
      'subscriptions', 'subscription_addons', 'charges',
      'ai_credit_wallets',
      'messages', 'message_recipients',
      'video_sessions',
      'form_check_uploads', 'form_check_comments',
      'notification_preferences',
      'streaks', 'badges', 'user_badges',
      'challenges', 'challenge_participants',
      'listings', 'events', 'tickets', 'products', 'orders'
    ])
  LOOP
    -- Only create trigger if the table has an updated_at column
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at
           BEFORE UPDATE ON %I
           FOR EACH ROW
           EXECUTE FUNCTION trigger_set_updated_at()',
        tbl, tbl
      );
    END IF;
  END LOOP;
END;
$$;


-- =============================================================================
-- APPEND-ONLY ENFORCEMENT: audit_logs
-- =============================================================================

-- Revoke UPDATE and DELETE on audit_logs to enforce append-only
-- This must be run by a superuser or table owner
REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;
-- Also revoke from the application role if known:
-- REVOKE UPDATE, DELETE ON audit_logs FROM forge_app;


-- =============================================================================
-- SUMMARY
-- =============================================================================
-- 54 tables created across 15 domains:
--   Domain 1:  Identity & Auth       (4)  users, user_sessions, device_tokens, audit_logs
--   Domain 2:  PT Modes & Hierarchy  (3)  pt_profiles, pt_modes, master_sub_relations
--   Domain 3:  Coaching              (3)  clients, client_pt_assignments, intake_forms
--   Domain 4:  Gym                   (3)  gyms, gym_memberships, gym_clients
--   Domain 5:  Programming           (6)  exercises, programs, program_weeks, program_days, program_blocks, program_exercises
--   Domain 6:  Logging & Sessions    (5)  workout_sessions, sets, exercise_prs, body_metrics, progress_photos
--   Domain 7:  Nutrition             (3)  meal_plans, food_items, food_logs
--   Domain 8:  Scheduling & Bookings (4)  schedules, classes, bookings, check_ins
--   Domain 9:  Billing               (5)  subscriptions, subscription_addons, charges, ai_credit_wallets, ai_credit_packs
--   Domain 10: AI                    (1)  ai_generations
--   Domain 11: Communication         (3)  messages, message_recipients, video_sessions
--   Domain 12: Form-Check            (2)  form_check_uploads, form_check_comments
--   Domain 13: Notifications         (2)  notifications, notification_preferences
--   Domain 14: Gamification          (5)  streaks, badges, user_badges, challenges, challenge_participants
--   Domain 15: Marketplace           (5)  listings, events, tickets, products, orders
--
-- Partitioned tables (4): sets, food_logs, notifications, audit_logs
-- ULID PK table (1): sets
-- Append-only table (1): audit_logs

COMMIT;

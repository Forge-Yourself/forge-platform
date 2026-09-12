#!/usr/bin/env node
// =============================================================================
// build_import_sql.mjs — deterministic JSON -> SQL generator for the exercise
// library. Reads forge_exercise_library_v1.json, validates every row against
// the exact CHECK constraint value lists in db/schema.sql, sorts by slug for
// byte-stable output, and emits one idempotent migration on stdout.
//
// Idempotent via ON CONFLICT (slug) DO UPDATE — re-running this generator
// against a longer/updated JSON file (the eventual 2,000+ licensed import)
// is a data-only regeneration: no code change, same migration shape.
//
// Usage: node db/exercises/build_import_sql.mjs > supabase/migrations/0008_exercise_library_v1.sql
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, 'forge_exercise_library_v1.json');

// Mirrors db/schema.sql's chk_exercises_* CHECK constraints exactly.
const MUSCLE_GROUPS = new Set([
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'quadriceps', 'hamstrings', 'glutes', 'calves', 'abs', 'obliques',
  'traps', 'lats', 'hip_flexors', 'adductors', 'abductors',
  'full_body', 'cardio', 'other',
]);
const EQUIPMENT = new Set([
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable',
  'bodyweight', 'resistance_band', 'smith_machine', 'trx',
  'medicine_ball', 'foam_roller', 'bench', 'pull_up_bar',
  'cardio_machine', 'other', 'none',
]);
const MOVEMENT_PATTERNS = new Set([
  'push', 'pull', 'squat', 'hinge', 'lunge', 'carry',
  'rotation', 'isometric', 'plyometric', 'cardio', 'stretch', 'other',
]);
const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);
const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function sqlQuote(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlTextArray(cues) {
  if (!cues || cues.length === 0) return "'{}'";
  const escaped = cues.map((c) => `"${String(c).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `'{${escaped.join(',')}}'`;
}

function validate(rows) {
  const seenSlugs = new Set();
  const errors = [];
  const coverage = { muscle_group: new Set(), equipment: new Set(), movement_pattern: new Set() };

  rows.forEach((row, i) => {
    const label = `row ${i} (${row.name ?? '<unnamed>'})`;
    if (!row.name || typeof row.name !== 'string') errors.push(`${label}: missing name`);
    if (!row.slug || !SLUG_RE.test(row.slug)) errors.push(`${label}: invalid slug "${row.slug}"`);
    if (row.slug && seenSlugs.has(row.slug)) errors.push(`${label}: duplicate slug "${row.slug}"`);
    if (row.slug) seenSlugs.add(row.slug);
    if (!MUSCLE_GROUPS.has(row.muscle_group)) errors.push(`${label}: invalid muscle_group "${row.muscle_group}"`);
    if (!EQUIPMENT.has(row.equipment)) errors.push(`${label}: invalid equipment "${row.equipment}"`);
    if (!MOVEMENT_PATTERNS.has(row.movement_pattern)) errors.push(`${label}: invalid movement_pattern "${row.movement_pattern}"`);
    if (row.difficulty != null && !DIFFICULTIES.has(row.difficulty)) errors.push(`${label}: invalid difficulty "${row.difficulty}"`);
    if (row.coaching_cues != null && !Array.isArray(row.coaching_cues)) errors.push(`${label}: coaching_cues must be an array`);

    if (MUSCLE_GROUPS.has(row.muscle_group)) coverage.muscle_group.add(row.muscle_group);
    if (EQUIPMENT.has(row.equipment)) coverage.equipment.add(row.equipment);
    if (MOVEMENT_PATTERNS.has(row.movement_pattern)) coverage.movement_pattern.add(row.movement_pattern);
  });

  const missingMuscle = [...MUSCLE_GROUPS].filter((v) => !coverage.muscle_group.has(v));
  const missingEquipment = [...EQUIPMENT].filter((v) => !coverage.equipment.has(v));
  const missingPattern = [...MOVEMENT_PATTERNS].filter((v) => !coverage.movement_pattern.has(v));
  if (missingMuscle.length) errors.push(`coverage gap — muscle_group never used: ${missingMuscle.join(', ')}`);
  if (missingEquipment.length) errors.push(`coverage gap — equipment never used: ${missingEquipment.join(', ')}`);
  if (missingPattern.length) errors.push(`coverage gap — movement_pattern never used: ${missingPattern.join(', ')}`);

  return errors;
}

function main() {
  const raw = readFileSync(SOURCE, 'utf-8');
  const rows = JSON.parse(raw);

  const errors = validate(rows);
  if (errors.length > 0) {
    process.stderr.write(`build_import_sql: ${errors.length} validation error(s):\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }

  // Sort by slug for byte-stable output — re-running this generator against
  // an unchanged source file must reproduce this file exactly (verification
  // check: diff the regenerated output against the committed migration).
  const sorted = [...rows].sort((a, b) => a.slug.localeCompare(b.slug));

  const valuesLines = sorted.map((r) => {
    return `  (${sqlQuote(r.name)}, ${sqlQuote(r.name_ar ?? null)}, ${sqlQuote(r.slug)}, ` +
      `${sqlQuote(r.muscle_group)}, ${sqlQuote(r.equipment)}, ${sqlQuote(r.movement_pattern)}, ` +
      `${sqlQuote(r.difficulty ?? null)}, ${sqlQuote(r.instructions ?? null)}, ` +
      `${sqlTextArray(r.coaching_cues)}, ${sqlQuote(r.demo_video_url ?? null)}, FALSE)`;
  });

  const out = `-- =============================================================================
-- 0008 · Exercise library v1 — GENERATED, do not hand-edit
-- =============================================================================
-- Generated by db/exercises/build_import_sql.mjs from
-- db/exercises/forge_exercise_library_v1.json. To change library content,
-- edit the JSON and regenerate this file — never edit the INSERT below by
-- hand, or the next regeneration will silently discard your change.
--
-- ${sorted.length} curated exercises covering every muscle_group, equipment
-- and movement_pattern CHECK value at least once (verified by the generator
-- itself — it refuses to emit output on a coverage gap). Absorbs db/seed.sql's
-- original 41 rows verbatim, including the two slugs badges key off
-- ('barbell_bench_press', 'barbell_back_squat').
--
-- Idempotent: ON CONFLICT (slug) DO UPDATE means the eventual 2,000+ licensed
-- import is a straight regeneration of this same file from a longer JSON
-- source — a data-only change, never a code change.
-- =============================================================================

BEGIN;

INSERT INTO public.exercises (
  name, name_ar, slug, muscle_group, equipment, movement_pattern,
  difficulty, instructions, coaching_cues, demo_video_url, is_custom
)
VALUES
${valuesLines.join(',\n')}
ON CONFLICT (slug) DO UPDATE SET
  name             = EXCLUDED.name,
  name_ar          = EXCLUDED.name_ar,
  muscle_group     = EXCLUDED.muscle_group,
  equipment        = EXCLUDED.equipment,
  movement_pattern = EXCLUDED.movement_pattern,
  difficulty       = EXCLUDED.difficulty,
  instructions     = EXCLUDED.instructions,
  coaching_cues    = EXCLUDED.coaching_cues,
  demo_video_url   = EXCLUDED.demo_video_url,
  updated_at       = NOW();

COMMIT;
`;

  process.stdout.write(out);
}

main();

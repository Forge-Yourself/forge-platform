import { z } from 'zod';

/** Matches db/schema.sql's `chk_users_locale` CHECK constraint exactly. */
export const localeSchema = z.enum(['en', 'ar', 'fr']);

/** Matches db/schema.sql's `chk_users_unit_system` CHECK constraint exactly. */
export const unitSystemSchema = z.enum(['metric', 'imperial']);

/**
 * Covers exactly the columns `supabase/migrations/0003_rls.sql` grants the
 * `authenticated` role UPDATE on for `public.users` (see the
 * `GRANT UPDATE (...)` list around line 141-144). Every field is optional so
 * this doubles as a partial-update payload — RLS/column grants are the real
 * enforcement boundary, this schema just keeps the client from attempting to
 * send a column (e.g. `role`) it was never granted.
 */
export const userProfileSchema = z
  .object({
    display_name: z.string().trim().min(1).max(120).optional(),
    avatar_url: z.string().url().optional(),
    phone: z.string().trim().min(1).optional(),
    locale: localeSchema.optional(),
    unit_system: unitSystemSchema.optional(),
    timezone: z.string().trim().min(1).optional(),
    consent_analytics: z.boolean().optional(),
    consent_marketing: z.boolean().optional(),
    consent_ai_training: z.boolean().optional(),
    onboarding_completed: z.boolean().optional(),
  })
  // .strict() so an ungranted column (e.g. `role`) fails validation instead
  // of being silently stripped — a caller who mistypes a key gets a signal
  // instead of a write that quietly goes nowhere.
  .strict();
export type UserProfileInput = z.infer<typeof userProfileSchema>;

/**
 * `pt_profiles` fields the profile editor owns.
 *
 * Deliberately EXCLUDES `hourly_rate_cents` and `currency`: those columns
 * exist on `pt_profiles`, but Forge never handles session pricing (it is
 * merchant of record for platform billing only — no inter-party payments),
 * so no schema field should exist for them. This is a deliberate omission,
 * not an oversight.
 */
export const ptProfileSchema = z.object({
  bio: z.string().max(300, 'Bio must be 300 characters or fewer').optional(),
  specializations: z.array(z.string()).optional(),
  languages: z.array(z.string()).optional(),
  years_experience: z.number().nonnegative().optional(),
  profile_photo_url: z.string().url().optional(),
});
export type PtProfileInput = z.infer<typeof ptProfileSchema>;

/** Matches `chk_pt_certifications_status` in 0004_m1_identity.sql exactly. */
export const ptCertificationStatusSchema = z.enum([
  'unverified',
  'in_review',
  'verified',
  'rejected',
]);

/**
 * For `public.pt_certifications` (0004_m1_identity.sql). Client code should
 * generally only ever construct rows with the default `unverified` status —
 * verification is a server/admin-side transition — but the full enum is
 * validated here so the same schema works for the read path too.
 */
export const ptCertificationSchema = z.object({
  name: z.string().trim().min(1, 'Certification name is required'),
  issuer: z.string().trim().min(1).optional(),
  expires_on: z.iso.date().optional(),
  status: ptCertificationStatusSchema.default('unverified'),
});
export type PtCertificationInput = z.infer<typeof ptCertificationSchema>;

/** HH:MM, 24-hour clock — round-trips a Postgres `TIME` column through JSON. */
export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time in HH:MM format');

/** For `notification_preferences.quiet_start` / `quiet_end`. */
export const quietHoursSchema = z.object({
  quiet_start: timeStringSchema.optional(),
  quiet_end: timeStringSchema.optional(),
});
export type QuietHoursInput = z.infer<typeof quietHoursSchema>;

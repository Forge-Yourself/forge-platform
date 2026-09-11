import { resources } from '@forge/shared';

/**
 * Stamped into every rendered PDF's footer. Bump this whenever the body
 * copy below changes — a waiver rendered under an older version stays
 * exactly as it was signed; this is what lets a support case tell which
 * wording a given signature actually agreed to.
 */
export const WAIVER_VERSION = 'v1';

/**
 * Sourced from packages/shared's own waiver.* i18n tree (Task 5) rather than
 * retyped here — one source of truth for the legal copy, read by both the
 * client-facing screen and this server-side render.
 */
export function waiverBodyText(locale: 'en' | 'ar'): string {
  const translation = resources[locale].translation as { waiver: { body: string } };
  return translation.waiver.body;
}

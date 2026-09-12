/**
 * Shared by (onboarding)/pt-profile (steps 3 & 4) and (app)/profile-edit — both
 * screens edit the same `pt_profiles.specializations`/`languages` TEXT[] columns via
 * ChipRow, which has no value/label split: the string shown IS the string stored.
 * These are deliberately kept as plain English canonical values rather than routed
 * through i18n — storing a translated label directly would make the same
 * specialization read as a different raw value depending on which locale the PT was
 * in when they picked it.
 */
export const SPECIALIZATION_OPTIONS = [
  'Strength Training',
  'Weight Loss',
  'Bodybuilding',
  'Powerlifting',
  'Mobility & Recovery',
  'Sports Performance',
  'Pre/Postnatal',
  'Nutrition Coaching',
  'Group Classes',
  'Rehab',
];

export const LANGUAGE_OPTIONS = ['Arabic', 'English', 'French', 'Armenian'];

/** Toggles `option` in/out of a ChipRow selection list. */
export function toggleOption(list: string[], setList: (v: string[]) => void, option: string): void {
  setList(list.includes(option) ? list.filter((o) => o !== option) : [...list, option]);
}

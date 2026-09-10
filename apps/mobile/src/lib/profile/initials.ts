/**
 * Avatar-upload is deferred to M4's Storage layer (progress photos etc. — see the M1
 * plan's Task 10, Step 6), so every screen that would show an avatar renders initials
 * instead when no `avatar_url`/`profile_photo_url` is set. Shared by
 * (onboarding)/pt-profile, (app)/profile and (app)/profile-edit so the fallback logic
 * (and its edge cases — empty string, single word, extra whitespace) lives in one place.
 */
export function initialsFor(displayName: string | null | undefined): string {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

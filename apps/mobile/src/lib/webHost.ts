/**
 * apps/web's deployed origin, for building the `/join` invite link (M2).
 * Defaults to production (README.md's documented Vercel URL) so a build with
 * no `EXPO_PUBLIC_WEB_HOST` set still produces a working link; override it to
 * point at a preview deployment during testing.
 */
export const WEB_HOST = process.env.EXPO_PUBLIC_WEB_HOST ?? 'https://forge-admin-one.vercel.app';

export function joinInviteUrl(email: string): string {
  return `${WEB_HOST}/join?email=${encodeURIComponent(email)}`;
}

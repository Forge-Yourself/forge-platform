/**
 * Avatar-upload is deferred to M4's Storage layer (progress photos etc. — see the M1
 * plan's Task 10, Step 6), so every screen that would show an avatar renders initials
 * instead when no `avatar_url`/`profile_photo_url` is set.
 *
 * The implementation lives with the component that draws it (ui/Avatar) so the roster
 * rows, the program cards and the profile header cannot drift apart; this module stays
 * as the import path the profile screens already use.
 */
export { initialsFor } from '../../ui/Avatar';

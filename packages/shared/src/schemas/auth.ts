import { z } from 'zod';

/**
 * Trims whitespace, lowercases, and validates email format. CITEXT on the
 * `users.email` column already makes lookups case-insensitive, but
 * normalizing client-side keeps display and comparison consistent.
 */
export const emailSchema = z.string().trim().toLowerCase().email();

/**
 * Mirrors Supabase's `password_requirements = "lower_upper_letters_digits"`
 * policy (set in 0002_auth_config.sql / Task 2) exactly — the client must
 * reject what the server would reject, never more and never less, or users
 * hit a client-pass/server-fail mismatch.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Self-service role picker. Only `pt` / `client` / `gym_account` are ever
 * accepted — matches `set_initial_role`'s CHECK in 0004_m1_identity.sql
 * exactly. `admin` has no self-service path, here or on the server.
 */
export const signUpRoleSchema = z.enum(['pt', 'client', 'gym_account']);

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  role: signUpRoleSchema,
  acceptedTerms: z.literal(true, { message: 'You must accept the terms to continue' }),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Exactly 6 numeric digits — a TOTP/MFA code. */
export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

/**
 * Plain scoring function (not a zod schema) driving the sign-up UI's
 * 3-segment password strength meter.
 *
 *   0 — fails passwordSchema outright.
 *   1 — passes the minimum (8+ chars, upper, lower, digit) and nothing more.
 *   2 — minimum PLUS either decent length (>=10 chars) or a special
 *       character, but not both.
 *   3 — length >= 12 AND a special character is present. Both signals are
 *       required: a long password with no character variety beyond the
 *       mandatory classes caps at 2, and a short password with a special
 *       character also caps at 2.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 {
  if (!passwordSchema.safeParse(password).success) return 0;

  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);
  const isLong = password.length >= 12;

  if (isLong && hasSpecialChar) return 3;
  if (password.length >= 10 || hasSpecialChar) return 2;
  return 1;
}

import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  forgotPasswordSchema,
  passwordSchema,
  passwordStrength,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  totpCodeSchema,
} from './auth';

describe('passwordSchema', () => {
  it('rejects passwords under 8 characters', () => {
    expect(passwordSchema.safeParse('Ab1').success).toBe(false);
    expect(passwordSchema.safeParse('Ab1defg').success).toBe(false); // 7 chars
  });

  it('rejects a password with no uppercase letter', () => {
    expect(passwordSchema.safeParse('lowercase1').success).toBe(false);
  });

  it('rejects a password with no lowercase letter', () => {
    expect(passwordSchema.safeParse('UPPERCASE1').success).toBe(false);
  });

  it('rejects a password with no digit', () => {
    expect(passwordSchema.safeParse('NoDigitsHere').success).toBe(false);
  });

  it('accepts a password meeting all minimum requirements', () => {
    expect(passwordSchema.safeParse('Abcdefg1').success).toBe(true);
  });
});

describe('emailSchema', () => {
  it('trims whitespace and lowercases the value', () => {
    const result = emailSchema.parse('  Foo.Bar@EXAMPLE.com  ');
    expect(result).toBe('foo.bar@example.com');
  });

  it('rejects a malformed email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('signInSchema', () => {
  it('accepts a valid email/password pair', () => {
    expect(signInSchema.safeParse({ email: 'a@b.com', password: 'anything' }).success).toBe(true);
  });

  it('rejects a missing password', () => {
    expect(signInSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('signUpSchema', () => {
  const base = {
    email: 'new@user.com',
    password: 'Abcdefg1',
    displayName: 'New User',
    acceptedTerms: true as const,
  };

  it('accepts role "pt"', () => {
    expect(signUpSchema.safeParse({ ...base, role: 'pt' }).success).toBe(true);
  });

  it('accepts role "client"', () => {
    expect(signUpSchema.safeParse({ ...base, role: 'client' }).success).toBe(true);
  });

  it('accepts role "gym_account"', () => {
    expect(signUpSchema.safeParse({ ...base, role: 'gym_account' }).success).toBe(true);
  });

  it('rejects role "admin"', () => {
    expect(signUpSchema.safeParse({ ...base, role: 'admin' }).success).toBe(false);
  });

  it('rejects an arbitrary role outside the allowed set', () => {
    expect(signUpSchema.safeParse({ ...base, role: 'superuser' }).success).toBe(false);
  });

  it('rejects a weak password even with a valid role', () => {
    expect(
      signUpSchema.safeParse({ ...base, password: 'weak', role: 'client' }).success,
    ).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts an email only', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts matching passwords', () => {
    expect(
      resetPasswordSchema.safeParse({ password: 'Abcdefg1', confirmPassword: 'Abcdefg1' })
        .success,
    ).toBe(true);
  });

  it('rejects mismatched passwords and attaches the error to confirmPassword', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'Abcdefg1',
      confirmPassword: 'Different1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['confirmPassword']);
    }
  });
});

describe('totpCodeSchema', () => {
  it('accepts exactly 6 digits', () => {
    expect(totpCodeSchema.safeParse('123456').success).toBe(true);
  });

  it('rejects 5 digits', () => {
    expect(totpCodeSchema.safeParse('12345').success).toBe(false);
  });

  it('rejects 7 digits', () => {
    expect(totpCodeSchema.safeParse('1234567').success).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(totpCodeSchema.safeParse('12a456').success).toBe(false);
  });
});

describe('passwordStrength', () => {
  it('returns 0 for a password that fails the minimum requirements', () => {
    expect(passwordStrength('short1')).toBe(0);
    expect(passwordStrength('nouppercase1')).toBe(0);
    expect(passwordStrength('NOLOWERCASE1')).toBe(0);
    expect(passwordStrength('NoDigitsHere')).toBe(0);
  });

  it('returns 1 for a password that only just meets the minimum', () => {
    expect(passwordStrength('Abcdefg1')).toBe(1); // 8 chars, no special, no extra length
  });

  it('returns 2 for a longer password with no special characters', () => {
    expect(passwordStrength('Abcdefghij1')).toBe(2); // 11 chars, no special char
  });

  it('returns 2 for a short password that adds a special character', () => {
    expect(passwordStrength('Abcdef1!')).toBe(2); // 8 chars, has special char
  });

  it('does not return 3 from length alone', () => {
    expect(passwordStrength('Abcdefghijklmnop1')).toBe(2); // 17 chars, no special char
  });

  it('does not return 3 from character variety alone', () => {
    expect(passwordStrength('Ab1!defg')).toBe(2); // 8 chars, has special char, but short
  });

  it('returns 3 only when length >= 12 AND a special character is present', () => {
    expect(passwordStrength('Abcdefghijk1!')).toBe(3); // 13 chars, has special char
  });

  it('every score is an integer between 0 and 3', () => {
    const samples = [
      '',
      'short1',
      'Abcdefg1',
      'Abcdefghij1',
      'Abcdefghijk1!',
      'aaaaaaaaaaaaaaaaaaaa',
    ];
    for (const s of samples) {
      const score = passwordStrength(s);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(3);
    }
  });
});

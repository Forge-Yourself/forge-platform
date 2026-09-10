import { describe, expect, it } from 'vitest';
import {
  ptCertificationSchema,
  ptProfileSchema,
  quietHoursSchema,
  userProfileSchema,
} from './profile';

describe('userProfileSchema', () => {
  it('accepts a partial update covering only the granted columns', () => {
    const result = userProfileSchema.safeParse({
      display_name: 'Jane Doe',
      avatar_url: 'https://example.com/a.png',
      phone: '+96170000000',
      locale: 'ar',
      unit_system: 'imperial',
      timezone: 'Asia/Beirut',
      consent_analytics: true,
      consent_marketing: false,
      consent_ai_training: true,
      onboarding_completed: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty object (nothing to update)', () => {
    expect(userProfileSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a locale outside en|ar|fr', () => {
    expect(userProfileSchema.safeParse({ locale: 'es' }).success).toBe(false);
  });

  it('rejects a unit_system outside metric|imperial', () => {
    expect(userProfileSchema.safeParse({ unit_system: 'freedom' }).success).toBe(false);
  });

  it('rejects fields outside the granted column list, e.g. role', () => {
    const result = userProfileSchema.safeParse({ role: 'admin' });
    // extra/unknown keys must not silently grant escalation via this schema
    expect('role' in (result.success ? result.data : {})).toBe(false);
  });
});

describe('ptProfileSchema', () => {
  it('accepts a well-formed pt profile', () => {
    const result = ptProfileSchema.safeParse({
      bio: 'Certified strength coach.',
      specializations: ['strength', 'mobility'],
      languages: ['en', 'ar'],
      years_experience: 5,
      profile_photo_url: 'https://example.com/p.jpg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a bio over 300 characters', () => {
    const result = ptProfileSchema.safeParse({ bio: 'x'.repeat(301) });
    expect(result.success).toBe(false);
  });

  it('accepts a bio at exactly 300 characters', () => {
    const result = ptProfileSchema.safeParse({ bio: 'x'.repeat(300) });
    expect(result.success).toBe(true);
  });

  it('rejects a negative years_experience', () => {
    expect(ptProfileSchema.safeParse({ years_experience: -1 }).success).toBe(false);
  });

  it('does not include hourly_rate_cents or currency fields', () => {
    expect('hourly_rate_cents' in ptProfileSchema.shape).toBe(false);
    expect('currency' in ptProfileSchema.shape).toBe(false);
  });
});

describe('ptCertificationSchema', () => {
  it('accepts a minimal certification with just a name', () => {
    expect(ptCertificationSchema.safeParse({ name: 'NASM CPT' }).success).toBe(true);
  });

  it('rejects a missing name', () => {
    expect(ptCertificationSchema.safeParse({}).success).toBe(false);
  });

  it('accepts every valid status value', () => {
    for (const status of ['unverified', 'in_review', 'verified', 'rejected']) {
      expect(ptCertificationSchema.safeParse({ name: 'X', status }).success).toBe(true);
    }
  });

  it('rejects an unknown status value', () => {
    expect(ptCertificationSchema.safeParse({ name: 'X', status: 'approved' }).success).toBe(
      false,
    );
  });

  it('defaults status to unverified when omitted', () => {
    const result = ptCertificationSchema.parse({ name: 'NASM CPT' });
    expect(result.status).toBe('unverified');
  });
});

describe('quietHoursSchema', () => {
  it('accepts valid HH:MM times', () => {
    expect(
      quietHoursSchema.safeParse({ quiet_start: '22:00', quiet_end: '06:30' }).success,
    ).toBe(true);
  });

  it('rejects an out-of-range hour', () => {
    expect(quietHoursSchema.safeParse({ quiet_start: '24:00' }).success).toBe(false);
  });

  it('rejects a malformed time string', () => {
    expect(quietHoursSchema.safeParse({ quiet_start: '9pm' }).success).toBe(false);
  });

  it('accepts an empty object (both times optional)', () => {
    expect(quietHoursSchema.safeParse({}).success).toBe(true);
  });
});

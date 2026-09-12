'use client';

import { signInSchema } from '@forge/shared/schemas';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import * as ui from '@/lib/ui/styles';

/**
 * Staff and PTs share one Supabase auth pool — signing in here only proves
 * the credentials are valid, not that the account is staff. After sign-in we
 * read the caller's own `users.role` (allowed under RLS: `id = auth.uid()`)
 * and sign straight back out if it isn't `admin`. This never uses the
 * service-role key — same anon-key session the rest of the admin surface
 * uses.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword(
        parsed.data,
      );

      if (signInError || !signInData.user) {
        setError('Invalid email or password.');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('role')
        .eq('id', signInData.user.id)
        .single();

      if (profileError || !profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        setError('This account does not have admin access.');
        return;
      }

      router.push('/admin');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={ui.page}>
      <p style={ui.kicker}>Forge</p>
      <h1 style={ui.h1}>Staff sign-in</h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Internal only. Sign in with a Forge account that has admin access.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ ...ui.card, display: 'flex', flexDirection: 'column', gap: 'var(--s-5)' }}
      >
        <div>
          <label style={ui.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={ui.input}
          />
        </div>

        <div>
          <label style={ui.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={ui.input}
          />
        </div>

        {error ? <p style={ui.errorText}>{error}</p> : null}

        <button type="submit" disabled={submitting} style={ui.button}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import * as ui from '@/lib/ui/styles';

/**
 * Ends the admin session. The admin surface had no way to do this at all — a staff
 * member on a shared machine could only close the tab and leave a live session in the
 * cookie jar, which is a poor posture for a console that can read every user row.
 *
 * Client component because signOut() has to clear the browser client's cookies; the
 * refresh() then makes middleware re-evaluate and bounce to /login.
 */
export function AdminSignOut() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={signingOut}
      style={ui.buttonSecondary}
    >
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

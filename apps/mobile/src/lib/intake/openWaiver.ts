import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../supabase';
import { WEB_HOST } from '../webHost';

/**
 * Fetches a short-lived signed URL for a signed waiver PDF from
 * apps/web's GET /api/waiver/[intakeId] (Task 15) — authorized there as
 * either the client owner or their PT — and opens it in the system browser.
 * Shared by ClientHome and the waiver-done confirmation screen so this logic
 * lives in exactly one place.
 */
export async function openWaiverDocument(intakeId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not signed in');
  }

  const res = await fetch(`${WEB_HOST}/api/waiver/${intakeId}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    throw new Error('Could not load the waiver');
  }

  const { url } = (await res.json()) as { url: string };
  await WebBrowser.openBrowserAsync(url);
}

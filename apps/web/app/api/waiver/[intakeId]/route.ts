import { createBearerClient, getBearerToken } from '@/lib/supabase/bearer';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * GET /api/waiver/[intakeId] — either the client owner or their PT may
 * fetch the signed URL. Authorization runs under the caller's own token
 * (RLS's `intake_forms_client_select` OR `intake_forms_pt_select` — a zero
 * row result covers "not yours" and "not signed yet" alike), then the
 * signed URL itself is minted with the service-role client since the
 * `waivers` bucket has no policies for `authenticated` at all.
 */
export async function GET(request: Request, { params }: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await params;

  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: 'missing bearer token' }, { status: 401 });
  }

  const bearer = createBearerClient(token);
  const { data: intake, error } = await bearer
    .from('intake_forms')
    .select('id, waiver_pdf_url, client_id')
    .eq('id', intakeId)
    .maybeSingle();

  if (error || !intake || !intake.waiver_pdf_url) {
    return Response.json({ error: 'waiver not found' }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: signed, error: signError } = await service.storage
    .from('waivers')
    .createSignedUrl(intake.waiver_pdf_url, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed) {
    return Response.json({ error: 'failed to sign url' }, { status: 500 });
  }

  return Response.json({ url: signed.signedUrl });
}

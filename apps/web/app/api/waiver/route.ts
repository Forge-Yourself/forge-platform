import { z } from 'zod';
import { renderWaiverPdf } from '@/lib/waiver/pdf';
import { createBearerClient, getBearerToken } from '@/lib/supabase/bearer';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  intakeFormId: z.string().uuid(),
  signatureSvgPath: z.string().min(1),
});

/**
 * POST /api/waiver — the client signs.
 *
 * Authorization is TWO gates, not one. RLS under the caller's own token scopes
 * the lookups (a zero-row result IS the 403), but it is deliberately wider than
 * this route: `intake_forms_pt_select` lets the PT read the same rows, so RLS
 * alone would let a PT sign on their client's behalf. The explicit
 * `client_user_id === user.id` check below is the second gate and the real one.
 *
 * Only then do the render/upload/stamp run on the service-role client — the
 * client's own session cannot write `waiver_pdf_url`/`signed_at`/`state`
 * themselves (`intake_forms_client_update`'s WITH CHECK forbids it by design,
 * see 0005_m2_clients_intake.sql), and Storage has no policies for
 * `authenticated` at all.
 */
export async function POST(request: Request) {
  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: 'missing bearer token' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid request body' }, { status: 400 });
  }
  const { intakeFormId, signatureSvgPath } = parsed.data;

  const bearer = createBearerClient(token);

  const {
    data: { user },
  } = await bearer.auth.getUser();
  if (!user) {
    return Response.json({ error: 'invalid token' }, { status: 401 });
  }

  // RLS (intake_forms_client_select) already scopes this to rows the caller
  // owns; a zero-row result here covers both "not theirs" and "not
  // submitted yet" — both are the same 403 from the caller's point of view.
  const { data: intake, error: intakeError } = await bearer
    .from('intake_forms')
    .select('id, client_id, state, waiver_pdf_url')
    .eq('id', intakeFormId)
    .in('state', ['completed', 'red_flag_review'])
    .maybeSingle();

  if (intakeError || !intake) {
    return Response.json({ error: 'intake not found or not ready to sign' }, { status: 403 });
  }
  if (intake.waiver_pdf_url) {
    return Response.json({ error: 'waiver already signed' }, { status: 409 });
  }

  const { data: client, error: clientError } = await bearer
    .from('clients')
    .select('id, pt_user_id, client_user_id')
    .eq('id', intake.client_id)
    .maybeSingle();
  if (clientError || !client) {
    return Response.json({ error: 'client not found' }, { status: 403 });
  }

  // RLS is NOT the whole gate here, despite what the two lookups above imply.
  // `intake_forms_pt_select` (0005) grants the PT SELECT on exactly the two
  // states this route filters on — a strict superset — so a PT's own bearer
  // token reaches their client's row and both queries succeed. Signing is the
  // CLIENT's act: a waiver is a liability release only the person being
  // released can give. So the caller must BE the linked client account.
  //
  // Without this check a PT could forge one, and it would be unrecoverable:
  // the upload is upsert:false and the state is stamped in the same request, so
  // the 409 above then locks the real client out of ever signing the real one.
  if (!client.client_user_id || client.client_user_id !== user.id) {
    return Response.json({ error: 'only the client can sign this waiver' }, { status: 403 });
  }

  const service = createServiceClient();

  const [{ data: clientUser }, { data: ptUser }] = await Promise.all([
    service.from('users').select('display_name').eq('id', client.client_user_id ?? '').maybeSingle(),
    service.from('users').select('display_name').eq('id', client.pt_user_id).maybeSingle(),
  ]);

  const signedAt = new Date();
  const pdfBytes = await renderWaiverPdf({
    clientName: clientUser?.display_name ?? 'Client',
    ptName: ptUser?.display_name ?? 'Trainer',
    signatureSvgPath,
    signedAt,
  });

  const objectPath = `${client.id}/${intake.id}.pdf`;
  const { error: uploadError } = await service.storage
    .from('waivers')
    .upload(objectPath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: false });
  if (uploadError) {
    return Response.json({ error: 'failed to store waiver' }, { status: 500 });
  }

  const { error: updateError } = await service
    .from('intake_forms')
    .update({ waiver_pdf_url: objectPath, signed_at: signedAt.toISOString(), state: 'waiver_signed' })
    .eq('id', intake.id);
  if (updateError) {
    return Response.json({ error: 'failed to record signature' }, { status: 500 });
  }

  // audit_logs is policy-free (service-role only) — actor_id set explicitly
  // to the bearer token's user, since the service-role connection has no
  // auth.uid() of its own to fall back on.
  await service.from('audit_logs').insert({
    actor_id: user.id,
    target_user_id: client.pt_user_id,
    action: 'waiver_sign',
    entity_type: 'intake_form',
    entity_id: intake.id,
  });

  return Response.json({ ok: true });
}

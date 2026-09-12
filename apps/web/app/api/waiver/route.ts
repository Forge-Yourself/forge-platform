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
 * POST /api/waiver — the client signs. Authorization runs under the
 * caller's OWN token against the anon-key client first (RLS is the real
 * gate: a zero-row result IS the 403), then the render/upload/stamp all use
 * the service-role client — the client's own session cannot write
 * `waiver_pdf_url`/`signed_at`/`state` themselves
 * (`intake_forms_client_update`'s WITH CHECK forbids it by design, see
 * 0005_m2_clients_intake.sql), and Storage has no policies for
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

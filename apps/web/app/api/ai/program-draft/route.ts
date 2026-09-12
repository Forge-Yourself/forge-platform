import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  aiDraftModelSchema,
  aiProgramDraftRequestSchema,
  creditState,
  type AiDraftModelOutput,
  type ResolvedDraft,
} from '@forge/shared';
import { buildCatalogue } from '@/lib/ai/catalog';
import {
  AI_EFFORT,
  AI_MAX_TOKENS,
  AI_MAX_UNRESOLVED_RATIO,
  AI_MODEL_ID,
  AI_TIMEOUT_MS,
} from '@/lib/ai/model';
import { buildDraftPrompt } from '@/lib/ai/prompt';
import { scrubForLog } from '@/lib/ai/scrub';
import { createBearerClient, getBearerToken } from '@/lib/supabase/bearer';

export const dynamic = 'force-dynamic';

/**
 * Vercel's default function ceiling is well below this route's own 25s SDK timeout,
 * so without this the platform kills a slow draft before the route's 504 handler can
 * run and the app sees an opaque gateway error instead of `ai.errors.timeout`. This
 * is the outer bound, not the target: AI_BUDGET_MS (12s) is what the route holds
 * itself to and AI_TIMEOUT_MS (25s) is when it gives up — this only guarantees the
 * platform lets it get that far.
 */
export const maxDuration = 60;

/**
 * POST /api/ai/program-draft — the AI broker, and the only place the
 * Anthropic key exists.
 *
 * The order below is D23's sequence, and it is load-bearing: the credit is
 * charged AFTER a usable draft exists, never before. That makes
 * refund-on-failure narrow by construction — every failure up to and
 * including the model call costs the PT nothing, and the response says so
 * with `charged: false` so the app never has to guess at the bill.
 *
 * Failure matrix (the app maps each onto its own copy):
 *   401 no/invalid bearer            charged: false
 *   400 malformed body               charged: false
 *   403 not this client's trainer    charged: false   (zero rows under RLS IS the 403)
 *   402 balance < 1                  charged: false
 *   502 model error/refusal/unparseable  charged: false
 *   504 model timeout                charged: false
 *   402 charge lost a concurrent race    charged: false (see the note at the charge)
 *
 * There is deliberately no "charged: true" branch. consume_ai_credit() is the last
 * thing this route does before returning, so no failure can land between the charge
 * and the response — which is what makes refund_ai_credit() an operator tool for
 * support cases rather than a path this route ever takes. If you add work after the
 * charge, you are adding that branch, and it needs the refund call and a `charged:
 * true` body to match what lib/ai/requestProgramDraft.ts already maps.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();

  const token = getBearerToken(request);
  if (!token) {
    return Response.json({ error: 'missing bearer token', charged: false }, { status: 401 });
  }

  const parsed = aiProgramDraftRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid request body', charged: false }, { status: 400 });
  }
  const input = parsed.data;

  const bearer = createBearerClient(token);
  const {
    data: { user },
  } = await bearer.auth.getUser();
  if (!user) {
    return Response.json({ error: 'invalid token', charged: false }, { status: 401 });
  }

  // Authorization is RLS's job, exactly as in the waiver routes: this read
  // runs under the caller's own token, and a zero-row result IS the 403.
  const { data: client, error: clientError } = await bearer
    .from('clients')
    .select('id, client_user_id, pt_user_id')
    .eq('id', input.clientId)
    .maybeSingle();
  if (clientError || !client) {
    return Response.json({ error: 'client not found', charged: false }, { status: 403 });
  }

  // Balance check, also under the caller's own token (ai_credit_wallets_select).
  const { data: wallet } = await bearer
    .from('ai_credit_wallets')
    .select('balance')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!wallet || wallet.balance < 1) {
    return Response.json({ error: 'insufficient credits', charged: false }, { status: 402 });
  }

  let catalogue;
  try {
    catalogue = await buildCatalogue(bearer, input.equipment);
  } catch {
    return Response.json({ error: 'catalogue unavailable', charged: false }, { status: 502 });
  }
  if (catalogue.count === 0) {
    return Response.json({ error: 'no exercises for that equipment', charged: false }, { status: 502 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ai is not configured', charged: false }, { status: 502 });
  }

  const prompt = buildDraftPrompt({ request: input, catalogue });

  let output: AiDraftModelOutput;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.parse(
      {
        model: AI_MODEL_ID,
        max_tokens: AI_MAX_TOKENS,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { effort: AI_EFFORT, format: zodOutputFormat(aiDraftModelSchema) },
      },
      // No retries: a retry would blow the 12s budget, and the PT would
      // rather be told to try again than watch a spinner for a minute.
      { timeout: AI_TIMEOUT_MS, maxRetries: 0 },
    );

    if (response.stop_reason === 'refusal') {
      return Response.json({ error: 'model declined', charged: false }, { status: 502 });
    }
    // parsed_output is null when the model's JSON did not satisfy the schema.
    // A real, handled path — not an assertion.
    if (!response.parsed_output) {
      return Response.json({ error: 'model output unusable', charged: false }, { status: 502 });
    }

    output = response.parsed_output;
    inputTokens = response.usage?.input_tokens ?? null;
    outputTokens = response.usage?.output_tokens ?? null;
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Anthropic.APIConnectionTimeoutError ||
      (err instanceof Error && err.name === 'AbortError');
    return Response.json(
      { error: isTimeout ? 'model timed out' : 'model call failed', charged: false },
      { status: isTimeout ? 504 : 502 },
    );
  }

  // Resolve every slug back to a real exercise. sort_order is assigned from
  // array position here rather than asked of the model, which is what makes
  // it impossible for AI output to trip uq_pb_day_sort / uq_pe_block_sort.
  let requested = 0;
  let unresolved = 0;
  const draft: ResolvedDraft = {
    summary: output.summary,
    weeks: output.weeks.map((week) => ({
      week_number: week.weekNumber,
      label: week.label,
      days: week.days.map((day) => ({
        day_number: day.dayNumber,
        label: day.label,
        blocks: day.blocks.map((block, blockIndex) => ({
          sort_order: blockIndex,
          block_type: block.blockType,
          label: block.label,
          rest_between_sec: block.restBetweenSec,
          exercises: block.exercises
            .map((exercise) => {
              requested += 1;
              const id = catalogue.idsBySlug.get(exercise.exerciseSlug);
              if (!id) {
                unresolved += 1;
                return null;
              }
              return {
                exercise_id: id,
                exercise_name: catalogue.namesBySlug.get(exercise.exerciseSlug) ?? exercise.exerciseSlug,
                why: exercise.why,
                target_sets: exercise.targetSets,
                target_reps_min: exercise.targetRepsMin,
                target_reps_max: exercise.targetRepsMax,
                target_rpe: exercise.targetRpe,
                rest_sec: exercise.restSec,
                tempo_prescribed: exercise.tempoPrescribed,
                sort_order: 0,
              };
            })
            .filter((exercise): exercise is NonNullable<typeof exercise> => exercise !== null)
            .map((exercise, exerciseIndex) => ({ ...exercise, sort_order: exerciseIndex })),
        })),
      })),
    })),
  };

  if (requested === 0 || unresolved / requested > AI_MAX_UNRESOLVED_RATIO) {
    // A program missing a fifth of its movements is not a program. Treat it
    // as a model failure rather than quietly handing over a thinned draft.
    return Response.json({ error: 'model output unusable', charged: false }, { status: 502 });
  }

  const [{ data: clientUser }, { data: ptUser }] = await Promise.all([
    bearer.from('users').select('display_name').eq('id', client.client_user_id ?? '').maybeSingle(),
    bearer.from('users').select('display_name').eq('id', client.pt_user_id).maybeSingle(),
  ]);
  const names = [clientUser?.display_name, ptUser?.display_name].filter(
    (name): name is string => typeof name === 'string',
  );

  // The charge. consume_ai_credit locks the wallet and lets chk_acw_balance
  // raise if a concurrent draft already spent the last credit.
  const { data: charge, error: chargeError } = await bearer.rpc('consume_ai_credit', {
    p_generation_type: 'program_draft',
    p_prompt_hash: prompt.hash,
    p_prompt_scrubbed: scrubForLog(prompt.user, names),
    p_output_scrubbed: scrubForLog(JSON.stringify(output), names),
    p_model_id: AI_MODEL_ID,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_latency_ms: Date.now() - startedAt,
  });

  const charged = charge?.[0];
  if (chargeError || !charged) {
    // A concurrent draft spent the last credit between the balance check
    // above and this charge, so chk_acw_balance raised.
    //
    // The plan called for returning the draft anyway with balance: 0, on the
    // principle of never punishing a user for our own race. That turns out
    // to be unimplementable rather than merely awkward: every path that
    // persists a draft goes through create_program_from_draft, which
    // requires an ai_generations row that only a successful charge creates.
    // A draft with no generation id is one the PT can look at and never
    // save — a worse outcome than a clear "no credit was charged".
    //
    // So the principle survives in the part that matters: nothing was
    // billed, and the app says so.
    return Response.json({ error: 'insufficient credits', charged: false }, { status: 402 });
  }

  return Response.json({
    generationId: charged.generation_id,
    balance: charged.new_balance,
    lowBalance: creditState(charged.new_balance) !== 'ok',
    draft,
  });
}

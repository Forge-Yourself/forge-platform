import { aiProgramDraftResponseSchema, type AiProgramDraftRequest, type AiProgramDraftResponse } from '@forge/shared';
import { supabase } from '../supabase';
import { WEB_HOST } from '../webHost';

/**
 * Which i18n key under `ai.errors.*` describes a failure, and — the part the
 * PT actually cares about — whether it cost them a credit. The route's own
 * failure matrix decides this; the app never guesses. A credit is only ever
 * charged after the model has returned a usable draft, so every pre-model
 * failure says so plainly.
 */
export type DraftFailure = { errorKey: string; charged: boolean };

export class ProgramDraftError extends Error {
  readonly failure: DraftFailure;

  constructor(failure: DraftFailure) {
    super(failure.errorKey);
    this.name = 'ProgramDraftError';
    this.failure = failure;
  }
}

/** Long enough to outlast the route's own 25s model timeout, then give up. */
const ABORT_MS = 30_000;

function failureFor(status: number, body: { error?: string; charged?: boolean } | null): DraftFailure {
  const charged = body?.charged === true;
  if (status === 401) return { errorKey: 'ai.errors.unauthorized', charged };
  if (status === 403) return { errorKey: 'ai.errors.forbidden', charged };
  if (status === 402) return { errorKey: 'ai.errors.insufficientCredits', charged };
  if (status === 504) return { errorKey: 'ai.errors.timeout', charged };
  if (status === 502) return { errorKey: 'ai.errors.model', charged };
  if (status === 500 && charged) return { errorKey: 'ai.errors.refunded', charged };
  return { errorKey: 'ai.errors.generic', charged };
}

/**
 * Calls apps/web's POST /api/ai/program-draft — the only place the Anthropic
 * key exists — and validates the reply against the same schema the route
 * validated on the way out.
 */
export async function requestProgramDraft(
  input: AiProgramDraftRequest,
): Promise<AiProgramDraftResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new ProgramDraftError({ errorKey: 'ai.errors.unauthorized', charged: false });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABORT_MS);

  let res: Response;
  try {
    res = await fetch(`${WEB_HOST}/api/ai/program-draft`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });
  } catch {
    // A hung socket must not leave the generating screen spinning forever.
    throw new ProgramDraftError({ errorKey: 'ai.errors.timeout', charged: false });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; charged?: boolean } | null;
    throw new ProgramDraftError(failureFor(res.status, body));
  }

  const parsed = aiProgramDraftResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    // The credit was spent server-side; saying otherwise would be a lie.
    throw new ProgramDraftError({ errorKey: 'ai.errors.generic', charged: true });
  }
  return parsed.data;
}

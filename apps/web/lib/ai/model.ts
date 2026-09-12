/**
 * Every knob the AI broker turns, in one file — and AI_MODEL_ID is written
 * into ai_generations.model_id on every row, so which model produced which
 * draft stays measurable from data rather than from memory.
 *
 * Notes that are easy to get wrong on the next edit, verified against the
 * current API rather than recalled:
 *   - On claude-opus-5 thinking is ON by default (adaptive). Do not send
 *     `thinking: { budget_tokens }` — it is removed on this model and returns
 *     a 400.
 *   - Depth is controlled by output_config.effort, which defaults to 'high'.
 *     'medium' is the starting point for the 12s budget; the documented lever
 *     order if that proves too slow is medium -> low -> and only then a
 *     different model, which is a product decision, not a code cleanup.
 *   - AI_MAX_TOKENS stays at the non-streaming ceiling that keeps a request
 *     inside the SDK's own HTTP timeout. A four-week program is nowhere near
 *     it; raising it would mean switching to streaming.
 */
export const AI_MODEL_ID = 'claude-opus-5';

export const AI_EFFORT = 'medium' as const;

export const AI_MAX_TOKENS = 16000;

/** Per-request ceiling handed to the SDK. Outlives the budget below on purpose. */
export const AI_TIMEOUT_MS = 25_000;

/** EP-15's acceptance figure. The app paces its progress checklist off this. */
export const AI_BUDGET_MS = 12_000;

/** How much of the library to offer the model. Enough to choose from, small enough to stay cheap. */
export const AI_CATALOGUE_LIMIT = 400;

/**
 * Above this share of unresolvable slugs the draft is treated as a model
 * failure rather than silently thinned — a program missing a fifth of its
 * movements is not a program.
 */
export const AI_MAX_UNRESOLVED_RATIO = 0.2;

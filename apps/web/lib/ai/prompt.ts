import { createHash } from 'node:crypto';
import type { AiProgramDraftRequest } from '@forge/shared';
import type { Catalogue } from './catalog';

export type DraftPrompt = { system: string; user: string; hash: string };

export type PromptContext = {
  request: AiProgramDraftRequest;
  catalogue: Catalogue;
  /** Bucketed, never exact — see the PII note below. */
  ageBand?: string | null;
  experienceNote?: string | null;
};

/**
 * Builds the prompt for a program draft.
 *
 * PII, layer 1 of 2: nothing identifying is interpolated here at all. The
 * client is "the client". No name, no email, no date of birth, no phone, no
 * UUID — not scrubbed afterwards, simply never sent. Age, if it is ever
 * included, arrives pre-bucketed by the caller.
 *
 * (Layer 2 is scrub.ts, which cleans what gets written to ai_generations.
 * Neither layer is a substitute for the other: layer 1 keeps identifiers off
 * the wire, layer 2 keeps them out of our own logs.)
 */
export function buildDraftPrompt(ctx: PromptContext): DraftPrompt {
  const { request, catalogue } = ctx;

  const system = [
    'You are an experienced strength coach drafting a training program for another coach to review.',
    'The coach edits every number before their client ever sees it, so be decisive rather than hedging.',
    '',
    'Rules:',
    '- Use ONLY exercises from the catalogue below, referenced by their exact slug. Never invent a slug.',
    '- Produce exactly ' + request.weeks + ' weeks, with real progression across them (load, volume, or density).',
    '- Between 2 and 5 training days per week, consistent from week to week.',
    '- Every exercise needs a one-sentence rationale for the coach, in the "why" field.',
    '- Respect the exclusions absolutely: if a movement is ruled out, no variation of it appears anywhere.',
    '- Order each session so the main movement comes first, accessories after, conditioning last.',
    '',
    'Catalogue (slug | name | muscle | pattern | equipment), ' + catalogue.count + ' movements:',
    catalogue.block,
  ].join('\n');

  const user = [
    'Goal: ' + request.goal.replace(/_/g, ' ') + '.',
    'Experience: ' + request.experience + '.',
    'Equipment available: ' + request.equipment.join(', ') + '.',
    ctx.ageBand ? 'Age band: ' + ctx.ageBand + '.' : null,
    ctx.experienceNote ? 'Coach notes: ' + ctx.experienceNote : null,
    request.avoid ? 'Must avoid: ' + request.avoid : 'No exclusions given.',
    '',
    'Draft the program.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  // 64 hex characters, which is exactly what ai_generations.prompt_hash is
  // sized for. It identifies a prompt without storing one.
  const hash = createHash('sha256').update(system + '\n' + user).digest('hex');

  return { system, user, hash };
}

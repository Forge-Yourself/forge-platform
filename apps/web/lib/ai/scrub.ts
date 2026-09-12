const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Four or more digits in a row: phone numbers, national ids, dates of birth. */
const LONG_DIGITS = /\b\d{4,}\b/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

const REDACTED = '[redacted]';

/** ai_generations.prompt_scrubbed / output_scrubbed are TEXT, but a log is not an archive. */
const MAX_LENGTH = 4000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PII, layer 2 of 2: cleans what gets written to ai_generations.
 *
 * Layer 1 (prompt.ts) already keeps identifiers off the wire entirely — this
 * is the backstop for anything that reaches the log by another route: a free
 * text exclusion a PT typed a name into, or model output that echoed one
 * back. Neither layer substitutes for the other.
 *
 * `names` are known tokens to strike (the client's display name, the PT's).
 * Single-character and very short tokens are ignored: striking every "Al" or
 * "Jo" would shred the surrounding text for no privacy gain.
 */
export function scrubForLog(text: string, names?: string[]): string;
export function scrubForLog(text: string | null | undefined, names?: string[]): string | null;
export function scrubForLog(text: string | null | undefined, names: string[] = []): string | null {
  if (!text) return null;

  let scrubbed = text
    .replace(EMAIL, REDACTED)
    .replace(UUID, REDACTED)
    .replace(ISO_DATE, REDACTED)
    .replace(LONG_DIGITS, REDACTED);

  for (const name of names) {
    for (const token of name.split(/\s+/)) {
      if (token.length < 3) continue;
      scrubbed = scrubbed.replace(new RegExp('\\b' + escapeRegExp(token) + '\\b', 'gi'), REDACTED);
    }
  }

  return scrubbed.length > MAX_LENGTH ? scrubbed.slice(0, MAX_LENGTH) + '…' : scrubbed;
}

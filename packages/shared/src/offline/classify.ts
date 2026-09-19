import type { RpcError } from './types';

export type ErrorClass = 'transient' | 'auth' | 'permanent';

const NETWORK = /network|failed to fetch|load failed/i;

/**
 * postgrest-js reports a request that never reached the server with an empty
 * code and the fetch TypeError text in message ("Failed to fetch" on web,
 * "Network request failed" on native, "Load failed" on Safari).
 */
export function isNetworkError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return (error.code ?? '') === '' && NETWORK.test(error.message ?? '');
}

/**
 * transient: retry the same entry later. auth: refresh the session, else
 * pause the queue until sign-in. permanent: the server said no; retrying the
 * same payload can never succeed, so the entry is parked as failed.
 */
export function classifyError(error: RpcError): ErrorClass {
  const code = error.code ?? '';
  if (code === 'PGRST301' || code === 'PGRST303') return 'auth';
  if (code === '') return 'transient';
  if (/^(22|23|42|P0)/.test(code) || code.startsWith('PGRST')) return 'permanent';
  return 'transient';
}

export function backoffMs(attempts: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, attempts - 1));
}

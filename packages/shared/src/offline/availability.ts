export type OfflineMode = 'off' | 'beta' | 'all';

/** app_config.offline_logging is JSONB; anything unexpected is off. */
export function parseOfflineMode(value: unknown): OfflineMode {
  return value === 'beta' || value === 'all' ? value : 'off';
}

/**
 * Spec §4.3. Available is the server's decision (mode, plus the per-user
 * beta flag in beta mode); effective adds the user's per-device choice.
 */
export function resolveOfflineLogging(input: {
  mode: OfflineMode;
  userBeta: boolean;
  deviceChoice: boolean;
}): { available: boolean; effective: boolean } {
  const available = input.mode === 'all' || (input.mode === 'beta' && input.userBeta);
  return { available, effective: available && input.deviceChoice };
}

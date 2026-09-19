import NetInfo from '@react-native-community/netinfo';
import { parseOfflineMode, resolveOfflineLogging, type OfflineMode, type QueueStatus } from '@forge/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { getStoredValue, setStoredValue } from '../deviceStore';
import { supabase } from '../supabase';
import { engine, OFFLINE_CHOICE_KEY, OFFLINE_MODE_KEY } from './engine';
import { OfflineContext, type OfflineContextValue } from './offlineContext';
import { warmCache } from './warmCache';

const WARM_EVERY_MS = 60_000;

export function OfflineProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const signedIn = auth.status === 'signedIn' && auth.user !== null;
  const [mode, setMode] = useState<OfflineMode>('off');
  const [deviceChoice, setChoice] = useState(false);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState<QueueStatus>({ pending: 0, failed: 0 });
  const [authPaused, setAuthPaused] = useState(false);
  const [warmedAt, setWarmedAt] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const lastWarm = useRef(0);

  const { available, effective } = resolveOfflineLogging({
    mode,
    userBeta: auth.user?.offline_logging_beta ?? false,
    deviceChoice,
  });

  // Last-known mode and the device choice, before any network (cold offline boot).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getStoredValue(OFFLINE_MODE_KEY), getStoredValue(OFFLINE_CHOICE_KEY), engine.getCache<string>('warmedAt'), engine.getCache<string>('syncedAt')]).then(
      ([m, c, w, sy]) => {
        if (cancelled) return;
        setMode(parseOfflineMode(m));
        setChoice(c === '1');
        setWarmedAt(w?.value ?? null);
        setSyncedAt(sy?.value ?? null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The server's mode, whenever we are signed in and online.
  useEffect(() => {
    if (!signedIn || !online) return;
    let cancelled = false;
    void supabase
      .from('app_config')
      .select('value')
      .eq('key', 'offline_logging')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const next = parseOfflineMode(data.value);
        setMode(next);
        void setStoredValue(OFFLINE_MODE_KEY, next);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, online]);

  useEffect(() => {
    return NetInfo.addEventListener((s) => {
      setOnline(s.isConnected !== false && s.isInternetReachable !== false);
    });
  }, []);

  useEffect(() => {
    const refresh = () => void engine.status().then(setStatus);
    refresh();
    return engine.subscribe((e) => {
      if (e.type === 'changed') refresh();
    });
  }, []);

  const drainNow = useCallback(() => {
    if (!online || !signedIn) return;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    void engine.drain().then((outcome) => {
      setAuthPaused(outcome.kind === 'auth');
      if (outcome.kind === 'transient') {
        retryTimer.current = setTimeout(() => setRetryTick((n) => n + 1), outcome.retryInMs);
      }
      if (outcome.kind === 'drained') {
        const at = new Date().toISOString();
        setSyncedAt(at);
        void engine.putCache('syncedAt', at);
        void engine.prune();
      }
    });
  }, [online, signedIn]);

  // Drain whenever the signal or the session comes back, and on each backoff
  // tick. Not gated on `effective`: a queue left behind by a switched-off mode
  // still drains.
  useEffect(() => {
    drainNow();
  }, [drainNow, retryTick]);

  const warm = useCallback(() => {
    if (!effective || !online || !signedIn || !auth.user) return;
    const now = Date.now();
    if (now - lastWarm.current < WARM_EVERY_MS) return;
    lastWarm.current = now;
    void warmCache(auth.user).then((at) => {
      if (at) setWarmedAt(at);
    });
  }, [effective, online, signedIn, auth.user]);

  useEffect(() => {
    warm();
  }, [warm]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      drainNow();
      warm();
    });
    return () => sub.remove();
  }, [drainNow, warm]);

  const setDeviceChoice = useCallback(
    async (next: boolean): Promise<'ok' | 'queue_not_empty'> => {
      if (!next) {
        const s = await engine.status();
        if (s.pending + s.failed > 0) return 'queue_not_empty';
      }
      await setStoredValue(OFFLINE_CHOICE_KEY, next ? '1' : '0');
      setChoice(next);
      if (next) lastWarm.current = 0;
      return 'ok';
    },
    [],
  );

  const discardAllAndDisable = useCallback(async () => {
    await engine.discardAll();
    await setStoredValue(OFFLINE_CHOICE_KEY, '0');
    setChoice(false);
  }, []);

  const value = useMemo<OfflineContextValue>(
    () => ({
      available,
      effective,
      online,
      status,
      authPaused,
      warmedAt,
      syncedAt,
      setDeviceChoice,
      discardAllAndDisable,
      drainNow,
    }),
    [available, effective, online, status, authPaused, warmedAt, syncedAt, setDeviceChoice, discardAllAndDisable, drainNow],
  );

  return <OfflineContext value={value}>{children}</OfflineContext>;
}

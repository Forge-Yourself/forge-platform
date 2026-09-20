import { soonest, type RestState } from '@forge/shared';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { restStore } from '../logging/restStore';
import { kvStore } from '../offline/kvStore';
import { restActivity } from './index';
import { payloadFor } from './payload';

const timerCue = require('../../../assets/sounds/timer-done.wav');
const ASKED_KEY = 'rest-permission-asked';

/**
 * The one owner of "a rest is running somewhere" (M4d spec §6.3, Corrections).
 * In the foreground: plays the zero cue for any live session's rest. In the
 * background: shows the soonest-ending rest on the lock screen. On return:
 * applies the taps made there. Renders nothing; mounted once under the auth
 * provider.
 */
export function RestActivityDriver() {
  const { t } = useTranslation();
  const auth = useAuth();
  const snap = useSyncExternalStore(restStore.subscribe, restStore.getSnapshot, restStore.getSnapshot);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [tick, setTick] = useState(() => Date.now());
  const fired = useRef(new Set<string>());
  const player = useAudioPlayer(timerCue);
  const active = appState === 'active';
  const now = Math.max(tick, snap.at);
  const top = soonest(Object.values(snap.rests), now);
  const latest = useRef({ top, t });
  useEffect(() => {
    latest.current = { top, t };
  });

  useEffect(() => {
    void restStore.hydrate();
    const sub = AppState.addEventListener('change', setAppState);
    const off = restActivity.addActionListener((a) => restStore.applyActions([a]));
    return () => {
      sub.remove();
      off();
    };
  }, []);

  // Sign-out: nothing of this user's may ring for the next one.
  const signedOut = auth.status === 'signedOut';
  useEffect(() => {
    if (!signedOut) return;
    restStore.reset();
    void restActivity.end();
  }, [signedOut]);

  // Wake at the next zero, so the in-app cue is on time.
  const nextZero = top?.endsAt ?? null;
  useEffect(() => {
    if (nextZero === null) return;
    const id = setTimeout(() => setTick(Date.now()), Math.max(0, nextZero - Date.now()) + 60);
    return () => clearTimeout(id);
  }, [nextZero]);

  // The zero cue, once per rest, for any session, only with the app open.
  useEffect(() => {
    if (!active) return;
    for (const r of Object.values(snap.rests) as RestState[]) {
      const key = `${r.sessionId}:${r.endsAt}`;
      if (r.pausedMs !== null || r.endsAt > now || now - r.endsAt > 5_000 || fired.current.has(key)) continue;
      fired.current.add(key);
      try {
        void player.seekTo(0).catch(() => undefined);
        player.play();
      } catch {
        /* the cue is optional; the haptic is the signal */
      }
      // PITFALLS W4: expo-haptics is a native-only no-op contract, not a web one.
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [active, now, snap.rests, player]);

  // The lock screen: only in the background, only the soonest running rest.
  const shownKey = !active && top ? `${top.sessionId}:${top.endsAt}:${top.totalMs}` : null;
  useEffect(() => {
    if (!restActivity.isAvailable()) return;
    const { top: current, t: translate } = latest.current;
    if (shownKey === null || !current) void restActivity.end();
    else void restActivity.show(payloadFor(current, translate));
  }, [shownKey]);

  // Back in the foreground: fold in what was tapped on the lock screen.
  useEffect(() => {
    if (!active) return;
    void restActivity.drainActions().then((actions) => {
      restStore.applyActions(actions);
      setTick(Date.now());
    });
  }, [active]);

  // The system permission prompt, once ever, the first time a rest exists.
  const hasRest = Object.keys(snap.rests).length > 0;
  useEffect(() => {
    if (!hasRest || !restActivity.isAvailable()) return;
    void kvStore.get<boolean>('meta', ASKED_KEY).then(async (asked) => {
      if (asked) return;
      await kvStore.write([{ table: 'meta', key: ASKED_KEY, value: true }]);
      await restActivity.requestPermission();
    });
  }, [hasRest]);

  return null;
}

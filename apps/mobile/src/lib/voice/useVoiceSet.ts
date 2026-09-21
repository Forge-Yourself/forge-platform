import { bestParse, type UnitSystem, type VoiceSetParse } from '@forge/shared';
import { requireOptionalNativeModule } from 'expo';
import type { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

/**
 * `expo-speech-recognition` calls `requireNativeModule` at import time, so a
 * static import throws in any binary without the native side — Expo Go, or a
 * build made before M4d. That throw kills the whole module, and with it every
 * screen that reaches VoiceSheet: expo-router then reports the session route as
 * "missing the required default export" (PITFALLS R3). Resolve it optionally
 * instead — with no module, voice reports `unavailable` and the rest of the
 * screen still runs. Web resolves the library's Web Speech implementation.
 */
const speech: typeof import('expo-speech-recognition') | null =
  Platform.OS === 'web' || requireOptionalNativeModule('ExpoSpeechRecognition') !== null
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay conditional; see above
      (require('expo-speech-recognition') as typeof import('expo-speech-recognition'))
    : null;

/** The library's event hook, or a no-op. `speech` is a module constant, so hook order never varies. */
const useSpeechEvent = (speech?.useSpeechRecognitionEvent ?? (() => {})) as typeof useSpeechRecognitionEvent;

export type VoicePhase = 'idle' | 'listening' | 'heard' | 'unavailable' | 'denied' | 'offline';

export type VoiceState = {
  phase: VoicePhase;
  /** The recognizer's words, verbatim: the PT must see what the mic got wrong (prototype `voice`). */
  transcript: string;
  parse: VoiceSetParse | null;
  /** 0 → 1 input level for the waveform. */
  level: number;
};

const IDLE: VoiceState = { phase: 'idle', transcript: '', parse: null, level: 0 };

/** Recognizer locales to try, in order (spec D6): iOS has no ar-LB, Android and Chrome do. */
function candidates(language: string): string[] {
  return language.startsWith('ar') ? ['ar-LB', 'ar-SA', 'ar'] : ['en-US', 'en-GB', 'en'];
}

/**
 * One utterance about the current set → a parse (M4d spec §7.2). On-device
 * recognition when the locale's model is installed; otherwise the platform's
 * network recognizer, refused up front with no connection. Every result
 * event re-parses all alternatives, so HEARD THIS shows the best of them.
 */
export function useVoiceSet(opts: { language: string; unit: UnitSystem; exerciseName: string; online: boolean }) {
  const [state, setState] = useState<VoiceState>(IDLE);
  const { language, unit, exerciseName, online } = opts;

  useSpeechEvent('result', (e) => {
    const alternatives = e.results.map((r) => r.transcript).filter((s) => s.trim() !== '');
    if (alternatives.length === 0) return;
    const best = bestParse(alternatives, unit);
    setState((s) => ({ ...s, transcript: best.transcript, parse: best.parse, phase: e.isFinal ? 'heard' : s.phase }));
  });
  useSpeechEvent('volumechange', (e) => {
    // The event reports −2…10; below 0 is silence.
    setState((s) => ({ ...s, level: Math.max(0, Math.min(1, e.value / 10)) }));
  });
  useSpeechEvent('end', () => {
    setState((s) => (s.phase === 'listening' ? { ...s, phase: 'heard', level: 0 } : s));
  });
  useSpeechEvent('error', (e) => {
    const phase: VoicePhase =
      e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'denied'
        : e.error === 'network'
          ? 'offline'
          : e.error === 'no-speech' || e.error === 'aborted' || e.error === 'interrupted'
            ? 'heard'
            : 'unavailable';
    setState((s) => ({ ...s, phase, level: 0 }));
  });

  const start = useCallback(async () => {
    // No native module in this binary (Expo Go, or a pre-M4d build): the sheet's
    // blocked screen, not a crash.
    if (!speech || !speech.ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setState({ ...IDLE, phase: 'unavailable' });
      return;
    }
    const permission = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setState({ ...IDLE, phase: 'denied' });
      return;
    }
    const supported = await speech.ExpoSpeechRecognitionModule.getSupportedLocales({}).catch(() => ({
      locales: [] as string[],
      installedLocales: [] as string[],
    }));
    const wanted = candidates(language);
    const lang = wanted.find((l) => supported.locales.includes(l)) ?? wanted[0] ?? 'en-US';
    const onDevice = supported.installedLocales.includes(lang) && speech.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    if (!onDevice && !online) {
      setState({ ...IDLE, phase: 'offline' });
      return;
    }
    setState({ ...IDLE, phase: 'listening' });
    speech.ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      maxAlternatives: 5,
      continuous: false,
      requiresOnDeviceRecognition: onDevice,
      addsPunctuation: false,
      contextualStrings: ['RPE', 'kilo', exerciseName],
      volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    });
  }, [language, online, exerciseName]);

  /** "Stop and use this": the recognizer finalises what it has and emits a last result. */
  const stop = useCallback(() => speech?.ExpoSpeechRecognitionModule.stop(), []);
  const abort = useCallback(() => {
    speech?.ExpoSpeechRecognitionModule.abort();
    setState(IDLE);
  }, []);

  return { state, start, stop, abort };
}

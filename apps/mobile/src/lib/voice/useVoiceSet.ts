import { bestParse, type UnitSystem, type VoiceSetParse } from '@forge/shared';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useState } from 'react';

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

  useSpeechRecognitionEvent('result', (e) => {
    const alternatives = e.results.map((r) => r.transcript).filter((s) => s.trim() !== '');
    if (alternatives.length === 0) return;
    const best = bestParse(alternatives, unit);
    setState((s) => ({ ...s, transcript: best.transcript, parse: best.parse, phase: e.isFinal ? 'heard' : s.phase }));
  });
  useSpeechRecognitionEvent('volumechange', (e) => {
    // The event reports −2…10; below 0 is silence.
    setState((s) => ({ ...s, level: Math.max(0, Math.min(1, e.value / 10)) }));
  });
  useSpeechRecognitionEvent('end', () => {
    setState((s) => (s.phase === 'listening' ? { ...s, phase: 'heard', level: 0 } : s));
  });
  useSpeechRecognitionEvent('error', (e) => {
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
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setState({ ...IDLE, phase: 'unavailable' });
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setState({ ...IDLE, phase: 'denied' });
      return;
    }
    const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({}).catch(() => ({
      locales: [] as string[],
      installedLocales: [] as string[],
    }));
    const wanted = candidates(language);
    const lang = wanted.find((l) => supported.locales.includes(l)) ?? wanted[0] ?? 'en-US';
    const onDevice = supported.installedLocales.includes(lang) && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    if (!onDevice && !online) {
      setState({ ...IDLE, phase: 'offline' });
      return;
    }
    setState({ ...IDLE, phase: 'listening' });
    ExpoSpeechRecognitionModule.start({
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
  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);
  const abort = useCallback(() => {
    ExpoSpeechRecognitionModule.abort();
    setState(IDLE);
  }, []);

  return { state, start, stop, abort };
}

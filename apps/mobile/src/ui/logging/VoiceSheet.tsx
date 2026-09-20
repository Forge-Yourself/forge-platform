import { kgToDisplay, displayToKg, LOGGING_LIMITS, unitLabel, type UnitSystem } from '@forge/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Modal, Pressable, View } from 'react-native';
import type { SubmitSetResult } from '../../lib/logging/useSessionController';
import { useVoiceSet } from '../../lib/voice/useVoiceSet';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { NumericKeypad } from '../NumericKeypad';
import { Text } from '../Text';
import { Waveform } from './Waveform';

// The prototype's fixed dark palette for arm's-length screens (same values as RestTimer).
const BG = '#0F131C';
const FG = '#F5F2EE';
const FG2 = '#CDD2DB';
const FG3 = '#9AA3B1';
const EMBER = '#FF8A3D';
const GREEN = '#7BC79A';
const CHIP = '#1C2230';
// Same pale-tint value as the app's dark-mode dangerAccent token (semantic.ts).
const DANGER = '#FADBD8';

type Values = { weightKg: number | null; reps: number | null; rpe: number | null };
type Field = 'weight' | 'reps' | 'rpe';

export type VoiceSheetProps = {
  visible: boolean;
  setNumber: number;
  exerciseName: string | null;
  unit: UnitSystem;
  language: string;
  online: boolean;
  /** Offline logging is on and there is no signal: LOGGED says "saved on this device". */
  queued: boolean;
  onLog: (values: Values) => Promise<SubmitSetResult>;
  onClose: () => void;
};

/**
 * M4d spec §7.3. LISTENING → HEARD THIS (verbatim transcript, three editable
 * chips) → LOGGED. Voice never logs without the PT seeing HEARD THIS first,
 * and a wrong number is fixed by tapping its chip, not by speaking again.
 */
export function VoiceSheet({ visible, setNumber, exerciseName, unit, language, online, queued, onLog, onClose }: VoiceSheetProps) {
  const { t } = useTranslation();
  const voice = useVoiceSet({ language, unit, exerciseName: exerciseName ?? '', online });
  const [values, setValues] = useState<Values>({ weightKg: null, reps: null, rpe: null });
  const [editing, setEditing] = useState<Field | null>(null);
  const [typed, setTyped] = useState('');
  const [logged, setLogged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Bumped on close, so a save that resolves afterwards knows it is stale.
  const session = useRef(0);
  const { phase, transcript, parse, level } = voice.state;

  // Open → listen. Close → stop listening, and forget.
  const { start, abort } = voice;
  useEffect(() => {
    if (!visible) return;
    void start();
    return () => abort();
  }, [visible, start, abort]);

  // The mic must not keep listening with no one looking at the screen, and a
  // PT who leaves for Settings to grant the mic permission needs the blocked
  // screen rechecked on return — `visible` itself never changes across that
  // round trip (same AppState pattern as RestActivityDriver).
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (phase === 'unavailable' || phase === 'denied' || phase === 'offline') void start();
      } else if (phase === 'listening') {
        abort();
      }
    });
    return () => sub.remove();
  }, [visible, phase, start, abort]);

  // Seed the chips from each new parse (adjust state during render, keyed on the parse object).
  const [seededFrom, setSeededFrom] = useState<typeof parse>(null);
  if (parse && parse !== seededFrom) {
    setSeededFrom(parse);
    setValues({ weightKg: parse.weightKg, reps: parse.reps, rpe: parse.rpe });
  }

  function close() {
    // A save still in flight must not paint LOGGED over the next set (PITFALLS O1).
    session.current += 1;
    setLogged(false);
    setSaveError(null);
    setEditing(null);
    setValues({ weightKg: null, reps: null, rpe: null });
    onClose();
  }

  function commitTyped() {
    const n = typed === '' ? null : Number(typed);
    setValues((v) =>
      editing === 'weight'
        ? { ...v, weightKg: n === null ? null : Math.min(displayToKg(n, unit), LOGGING_LIMITS.weight_kg.max) }
        : editing === 'reps'
          ? { ...v, reps: n === null ? null : Math.min(Math.round(n), LOGGING_LIMITS.reps.max) }
          : { ...v, rpe: n === null ? null : Math.min(10, Math.max(1, Math.round(n * 2) / 2)) },
    );
    setEditing(null);
  }

  async function log() {
    const mine = session.current;
    setSaving(true);
    setSaveError(null);
    const result = await onLog(values);
    if (mine !== session.current) return;
    setSaving(false);
    if (result.ok) {
      setLogged(true);
    } else {
      setSaveError(result.error ?? t('logging.session.errorGeneric'));
    }
  }

  const heard = phase === 'heard' && !logged;
  const stateLabel = logged ? t('logging.voice.logged') : phase === 'listening' ? t('logging.voice.listening') : t('logging.voice.heard');
  const stateColor = logged ? GREEN : phase === 'listening' ? EMBER : FG3;
  const blocked = phase === 'unavailable' || phase === 'denied' || phase === 'offline';
  const hint = logged
    ? t(queued ? 'logging.voice.hintLoggedOffline' : 'logging.voice.hintLogged', { n: setNumber })
    : saveError
      ? saveError
      : phase === 'listening'
        ? t('logging.voice.hintListening')
        : parse?.confidence === 'none' || (!parse && heard)
          ? t('logging.voice.hintNothing')
          : t('logging.voice.hintHeard');
  const chips: { key: Field; label: string; value: string }[] = [
    { key: 'weight', label: t('logging.voice.chipWeight', { unit: unitLabel(unit) }), value: values.weightKg === null ? '—' : String(kgToDisplay(values.weightKg, unit)) },
    { key: 'reps', label: t('logging.voice.chipReps'), value: values.reps === null ? '—' : String(values.reps) },
    { key: 'rpe', label: t('logging.voice.chipRpe'), value: values.rpe === null ? '—' : String(values.rpe) },
  ];
  const canLog = values.weightKg !== null || values.reps !== null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: BG, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: FG3, fontSize: 12, fontWeight: '700', letterSpacing: 1.4 }}>
            {exerciseName
              ? t('logging.voice.kicker', { n: setNumber, exercise: exerciseName.toUpperCase() })
              : t('logging.voice.kickerNoExercise', { n: setNumber })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('logging.voice.close')}
            onPress={close}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={22} color={FG2} />
          </Pressable>
        </View>

        {blocked ? (
          <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
            <Text style={{ color: FG, fontSize: 20, fontWeight: '800' }}>
              {phase === 'denied' ? t('logging.voice.permissionTitle') : phase === 'offline' ? t('logging.voice.needsConnection') : t('logging.voice.unavailable')}
            </Text>
            {phase === 'denied' ? (
              <>
                <Text style={{ color: FG2, fontSize: 14, lineHeight: 21 }}>{t('logging.voice.permissionBody')}</Text>
                <Button label={t('logging.voice.openSettings')} variant="ghost" onPress={() => void Linking.openSettings()} />
              </>
            ) : null}
            <Button label={t('logging.voice.back')} variant="link" onPress={close} />
          </View>
        ) : (
          <>
            <View style={{ flex: 1, justifyContent: 'center', gap: 18 }}>
              <Text accessibilityLiveRegion="polite" style={{ color: stateColor, fontSize: 12, fontWeight: '800', letterSpacing: 1.6 }}>
                {stateLabel}
              </Text>
              <Waveform level={level} active={phase === 'listening'} color={EMBER} />
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: FG, fontSize: 22, fontWeight: '700', lineHeight: 30, textAlign: 'center' }}
              >
                {transcript === '' ? '…' : `“${transcript}”`}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {chips.map((c) => (
                  <Pressable
                    key={c.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.label}: ${c.value}`}
                    disabled={!heard}
                    onPress={() => {
                      setTyped('');
                      setEditing(c.key);
                    }}
                    style={{
                      flex: 1,
                      minHeight: 64,
                      borderRadius: 14,
                      backgroundColor: CHIP,
                      borderWidth: 1.5,
                      borderColor: editing === c.key ? EMBER : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text numeric style={{ color: FG, fontSize: 24, fontWeight: '700' }}>
                      {c.value}
                    </Text>
                    <Text style={{ color: FG3, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 2 }}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: saveError ? DANGER : FG2, fontSize: 13.5, textAlign: 'center' }}
              >
                {hint}
              </Text>
            </View>

            {editing ? (
              <View style={{ gap: 10 }}>
                <Text numeric style={{ color: FG, fontSize: 36, fontWeight: '700', textAlign: 'center' }}>
                  {typed === '' ? '—' : typed}
                </Text>
                <NumericKeypad
                  onKey={(d) => setTyped((v) => (v.length >= 6 ? v : v + d))}
                  onDelete={() => setTyped((v) => v.slice(0, -1))}
                  extraKey={
                    editing === 'reps'
                      ? undefined
                      : { label: '.', onPress: () => setTyped((v) => (v.includes('.') || v === '' ? v : v + '.')) }
                  }
                />
                <Button label={t('common.done')} size="lg" onPress={commitTyped} />
              </View>
            ) : logged ? (
              <Button label={t('logging.voice.back')} size="lg" onPress={close} />
            ) : phase === 'listening' ? (
              <Button label={t('logging.voice.stop')} size="lg" onPress={voice.stop} />
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t('logging.voice.tryAgain')}
                    variant="ghost"
                    size="lg"
                    onPress={() => {
                      setSaveError(null);
                      void start();
                    }}
                  />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Button
                    label={t('logging.voice.logSetN', { n: setNumber })}
                    size="lg"
                    disabled={!canLog || saving}
                    loading={saving}
                    onPress={() => void log()}
                  />
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

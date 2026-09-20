import { displayToKg, kgToDisplay, unitLabel } from '@forge/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { isExerciseDone, workingCount } from '../../lib/logging/sessionModel';
import { nameOf, shownNumber, useSessionController, type SessionController } from '../../lib/logging/useSessionController';
import { OFFLINE } from '../../lib/offline/cachedFetch';
import { useTheme } from '../../theme/ThemeProvider';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import { LiveBadge } from '../LiveBadge';
import { RestStrip } from '../RestStrip';
import { Row } from '../Row';
import { Screen } from '../Screen';
import { SegmentedPill } from '../SegmentedPill';
import { SetStepper } from '../SetStepper';
import { Skeleton } from '../Skeleton';
import { Text } from '../Text';
import { FloorRail } from './FloorRail';
import { SessionSheets } from './SessionSheets';
import { SessionSummary } from './SessionSummary';
import { VoiceSheet } from './VoiceSheet';

type Mirror = { joined: boolean; devices: number };

/**
 * Prototype `ipad_console` (M4d spec §8): the rail stays mounted while the
 * body is keyed on the session, so switching client swaps the plan and the
 * logging panel and keeps the rail and every rest clock.
 */
export function ConsoleShell({ sessionId }: { sessionId: string }) {
  const [mirror, setMirror] = useState<Mirror>({ joined: false, devices: 0 });
  return (
    <Screen padded={false}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <FloorRail currentSessionId={sessionId} mirror={mirror} />
        <ConsoleBody key={sessionId} sessionId={sessionId} onMirror={setMirror} />
      </View>
    </Screen>
  );
}

function ConsoleBody({ sessionId, onMirror }: { sessionId: string; onMirror: (m: Mirror) => void }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const c = useSessionController(sessionId);
  const { live, devices } = c;
  useEffect(() => {
    onMirror({ joined: live, devices });
  }, [live, devices, onMirror]);

  if (c.data.loading) {
    return (
      <View style={{ flex: 1, padding: theme.space[5], gap: theme.space[3] }}>
        <Skeleton height={48} />
        <Skeleton height={320} />
      </View>
    );
  }
  if (c.data.error || !c.session) {
    return (
      <View style={{ flex: 1 }}>
        <EmptyState
          icon="alert"
          tone="danger"
          title={c.data.error === OFFLINE ? t('logging.offline.needsConnection') : t('logging.session.notFound')}
          body={c.data.error === OFFLINE ? t('logging.offline.needsConnectionBody') : t('logging.session.notFoundBody')}
          actionLabel={t('common.back')}
          actionVariant="ghost"
          onAction={() => router.dismissTo('/')}
        />
      </View>
    );
  }
  if (!c.inProgress) {
    return (
      <View style={{ flex: 1 }}>
        <SessionSummary c={c} />
      </View>
    );
  }
  return (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ConsoleHeader c={c} />
        <PlanPane c={c} />
      </View>
      <EntryPane c={c} />
      <SessionSheets c={c} />
      <VoiceSheet
        visible={c.voiceOpen}
        setNumber={c.setNo}
        exerciseName={c.current ? nameOf(c.current) : null}
        unit={c.unit}
        language={i18n.language}
        online={c.offline.online}
        queued={c.offline.effective && !c.offline.online}
        onLog={c.logVoice}
        onClose={() => c.setVoiceOpen(false)}
      />
    </>
  );
}

function ConsoleHeader({ c }: { c: SessionController }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Row style={{ gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={c.goBack}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="chevronBack" size={22} color={theme.colors.textPrimary} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: 18, fontWeight: '800' }}>
          {c.title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: theme.colors.textMuted }}>
          {c.subtitle}
        </Text>
      </View>
      {!c.offline.online ? <LiveBadge state="offline" label={t('logging.offline.notLive')} /> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          c.setFinishDraft(c.draftNote());
          c.setFinishOpen(true);
        }}
        style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 11, borderWidth: 1.5, borderColor: theme.colors.border, justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary }}>{t('logging.console.endSession')}</Text>
      </Pressable>
    </Row>
  );
}

function PlanPane({ c }: { c: SessionController }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
      <Text accessibilityRole="header" style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: theme.colors.textMuted, marginBottom: 4 }}>
        {t('logging.console.plan').toUpperCase()}
      </Text>
      {c.exercises.map((ex, i) => {
        const n = workingCount(c.data.sets, ex.exerciseId);
        const complete = isExerciseDone(ex, c.data.sets);
        const selected = i === c.currentPos;
        return (
          <Pressable
            key={ex.exerciseId}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => c.setExerciseIndex(i)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              minHeight: 60,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: selected ? theme.colors.accent : theme.colors.border,
              backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
            }}
          >
            <Text numeric style={{ width: 28, fontSize: 12, fontWeight: '700', color: theme.colors.accentText }}>
              {ex.slot ?? '+'}
            </Text>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '600' }}>
              {nameOf(ex)}
            </Text>
            <Text numeric style={{ fontSize: 13, fontWeight: '700', color: complete ? theme.colors.successAccent : theme.colors.textMuted }}>
              {ex.targetSets !== null ? `${n}/${ex.targetSets}` : String(n)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EntryPane({ c }: { c: SessionController }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { current, draft, setDraft, unit } = c;
  const bigStep = unit === 'imperial' ? 10 : 5;
  const smallStep = unit === 'imperial' ? 5 : 2.5;
  const nudgeWeight = (delta: number) =>
    setDraft((d) => ({ ...d, weightKg: Math.max(0, displayToKg(kgToDisplay(d.weightKg ?? 0, unit) + delta, unit)) }));
  const rpeItems = [{ label: '—', value: '' }, ...[6, 7, 8, 9, 10].map((n) => ({ label: String(n), value: String(n) }))];
  const kicker =
    current?.targetSets != null
      ? t('logging.console.nowLogging', { n: c.setNo, total: current.targetSets })
      : t('logging.console.nowLoggingSimple', { n: c.setNo });

  return (
    <View style={{ width: 320, padding: 18, gap: 12, borderStartWidth: 1, borderStartColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
      {current ? (
        <>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: theme.colors.accentText }}>{kicker.toUpperCase()}</Text>
          <Text numberOfLines={2} style={{ fontSize: 20, fontWeight: '800' }}>
            {nameOf(current)}
          </Text>
          <Row style={{ gap: 6, alignItems: 'baseline' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('logging.session.weight')} onPress={() => c.openKeypad('weight')} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text numeric style={{ fontSize: 40, fontWeight: '800' }}>
                {draft.weightKg === null ? '—' : shownNumber(draft.weightKg, unit)}
              </Text>
            </Pressable>
            <Text style={{ fontSize: 15, color: theme.colors.textMuted }}>{unitLabel(unit)} ×</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('logging.session.reps')} onPress={() => c.openKeypad('reps')} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text numeric style={{ fontSize: 40, fontWeight: '800' }}>
                {draft.reps === null ? '—' : String(draft.reps)}
              </Text>
            </Pressable>
          </Row>
          <Text numeric style={{ fontSize: 12.5, color: theme.colors.textMuted }}>
            {c.last ? t('logging.console.last', { summary: c.setLine(c.last) }) : t('logging.console.lastNone')}
          </Text>
          <SetStepper
            steps={[
              { label: `−${bigStep}`, delta: -bigStep },
              { label: `−${smallStep}`, delta: -smallStep },
              { label: `+${smallStep}`, delta: smallStep },
              { label: `+${bigStep}`, delta: bigStep },
            ]}
            onStep={nudgeWeight}
          />
          <SetStepper
            steps={[
              { label: '−1', delta: -1 },
              { label: '+1', delta: 1 },
            ]}
            onStep={(d) => setDraft((x) => ({ ...x, reps: Math.max(0, (x.reps ?? 0) + d) }))}
          />
          <SegmentedPill
            items={rpeItems}
            selected={draft.rpe === null ? '' : String(draft.rpe)}
            onChange={(v) => setDraft((x) => ({ ...x, rpe: v === '' ? null : Number(v) }))}
          />
          {c.rest.active ? (
            <RestStrip
              phase={c.rest.phase}
              remaining={c.rest.remaining}
              progress={c.rest.progress}
              caption={c.restCaption}
              plus30Label={t('logging.timer.plus30')}
              skipLabel={t('logging.timer.skipShort')}
              expandLabel={t('logging.session.openTimer')}
              onExpand={() => c.setTimerOpen(true)}
              onPlus30={c.rest.plus30}
              onSkip={c.rest.clear}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          {/* 60pt and pinned: "Log this set never moves" (prototype annotation). */}
          <Pressable
            accessibilityRole="button"
            disabled={!c.canLog}
            onPress={() => void c.submitSet(null, draft)}
            style={({ pressed }) => ({
              minHeight: 60,
              borderRadius: 14,
              backgroundColor: theme.colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !c.canLog ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <Text style={{ fontSize: 17, fontWeight: '800', color: theme.colors.onAccent }}>{t('logging.console.logThisSet')}</Text>
          </Pressable>
          <Row style={{ gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('logging.voice.mic')}
              onPress={() => c.setVoiceOpen(true)}
              style={{ flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: theme.colors.border, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="mic" size={18} color={theme.colors.textSecondary} />
              <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary }}>{t('logging.console.voice')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!c.next}
              onPress={() => c.setExerciseIndex(c.currentPos + 1)}
              style={{ flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', opacity: c.next ? 1 : 0.5 }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary }}>{t('logging.console.skipSet')}</Text>
            </Pressable>
          </Row>
        </>
      ) : (
        <EmptyState icon="dumbbell" title={t('logging.session.noExercises')} body={t('logging.session.noExercisesBody')} actionLabel={t('logging.session.addExercise')} onAction={c.openPicker} />
      )}
    </View>
  );
}

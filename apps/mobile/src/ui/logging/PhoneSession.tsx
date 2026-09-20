import { LOGGING_LIMITS } from '@forge/shared';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { isExerciseDone, workingCount } from '../../lib/logging/sessionModel';
import type { SetRow } from '../../lib/logging/sessionRpc';
import { nameOf, shownNumber, type SessionController } from '../../lib/logging/useSessionController';
import { OfflineStatusChip } from '../../lib/offline/OfflineStatusChip';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Icon } from '../Icon';
import { LiveBadge } from '../LiveBadge';
import { RestStrip } from '../RestStrip';
import { Row } from '../Row';
import { Screen } from '../Screen';
import { Text } from '../Text';
import { TextField } from '../TextField';
import { Toggle } from '../Toggle';
import { GhostTile, InfoTile, MicroLabel } from './sessionParts';
import { SessionSheets } from './SessionSheets';
import { SetRowView } from './SetRowView';
import { VoiceSheet } from './VoiceSheet';

/** Prototype `session`, phone layout. */
export function PhoneSession({ c }: { c: SessionController }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const {
    unit, data, offline, live, viewerId, viewerIsClient, exercises, displayNo, pickerOff, current, currentPos,
    setExerciseIndex, draft, setDraft, openKeypad, noteOpen, setNoteOpen, pending, setTimerOpen, listOpen,
    setListOpen, setEditing, setFinishOpen, setFinishDraft, rest, openPicker, submitSet, draftNote, goBack,
    title, subtitle, weightLabel, warmups, workingSets, setNo, futureRows, last, best, next, reps, rx, setLine,
    canLog, logLabel, restCaption, voiceOpen, setVoiceOpen, logVoice, session,
  } = c;

  const doneRow = (s: SetRow) => {
    const mine = s.logged_by_user_id === viewerId;
    const editable = !viewerIsClient || mine;
    const p = pending[s.id];
    return (
      <View key={s.id} style={{ gap: 4 }}>
        <SetRowView
          n={s.is_warmup ? t('logging.session.warmupShort') : String(displayNo[s.id] ?? s.set_number)}
          weight={s.weight_kg === null ? '—' : shownNumber(s.weight_kg, unit)}
          reps={s.reps === null ? '—' : String(s.reps)}
          rpe={s.rpe === null ? '—' : String(s.rpe)}
          labels={{ weight: weightLabel, reps: t('logging.session.cellReps'), rpe: t('logging.session.rpe') }}
          state="done"
          error={!!p?.error}
          coach={!mine && viewerIsClient ? t('logging.session.coachTag') : null}
          a11yCheck={editable ? t('logging.session.editSetN', { n: displayNo[s.id] ?? s.set_number }) : undefined}
          onCheck={editable ? () => setEditing(s) : undefined}
        />
        {p?.error ? (
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4 }}>
            <Text variant="caption" style={{ color: theme.colors.dangerAccent, flex: 1 }}>
              {p.error}
            </Text>
            <Button
              label={t('common.retry')}
              variant="link"
              onPress={() =>
                void submitSet(s, {
                  weightKg: s.weight_kg,
                  reps: s.reps,
                  rpe: s.rpe,
                  notes: s.notes ?? '',
                  isWarmup: s.is_warmup,
                })
              }
            />
          </Row>
        ) : null}
        {p?.queued && !p.error ? (
          <Text variant="caption" tone="muted" style={{ paddingHorizontal: 4 }}>
            {t('logging.offline.notSynced')}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <Screen padded={false}>
      {/* Prototype `session` header: back, who and where, elapsed, and the status
          pill on the right: OFFLINE with no signal, Live while the mirror is joined. */}
      <Row style={{ gap: 10, paddingTop: 6, paddingHorizontal: 12, paddingBottom: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={goBack}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevronBack" size={22} color={theme.colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: theme.colors.textMuted }}>
            {subtitle}
          </Text>
        </View>
        {!offline.online ? (
          <LiveBadge state="offline" label={t('logging.offline.notLive')} />
        ) : live ? (
          <LiveBadge state="live" label={t('logging.offline.live')} />
        ) : null}
      </Row>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <OfflineStatusChip style={{ marginBottom: 12 }} />
        {!current ? (
          <EmptyState
            icon="dumbbell"
            title={t('logging.session.noExercises')}
            // Offline the library is out of reach: say so rather than offer an
            // Add that cannot open (PITFALLS N14).
            body={pickerOff ? t('logging.offline.needsConnection') : t('logging.session.noExercisesBody')}
            {...(pickerOff ? {} : { actionLabel: t('logging.session.addExercise'), onAction: openPicker })}
          />
        ) : (
          <>
            <Row style={{ alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              {current.slot ? (
                <Text numeric style={{ fontSize: 11, fontWeight: '700', color: theme.colors.accentText }}>
                  {current.slot}
                </Text>
              ) : null}
              <Text
                numberOfLines={2}
                style={{ flex: 1, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 }}
              >
                {nameOf(current)}
              </Text>
            </Row>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 14 }}>{rx}</Text>

            {viewerIsClient ? (
              current.cue ? (
                <View
                  style={{
                    backgroundColor: theme.colors.surfaceSunken,
                    borderRadius: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    marginBottom: 14,
                  }}
                >
                  <MicroLabel>{t('logging.session.coachCue')}</MicroLabel>
                  <Text style={{ fontSize: 13.5, lineHeight: 20, marginTop: 5 }}>{current.cue}</Text>
                </View>
              ) : null
            ) : (
              <Row style={{ gap: 8, marginBottom: 14, alignItems: 'stretch' }}>
                <InfoTile
                  label={t('logging.session.lastSession')}
                  value={last ? setLine(last) : t('logging.session.firstTimeShort')}
                />
                <InfoTile
                  label={t('logging.session.best')}
                  value={
                    best
                      ? t(best.reps === null ? 'logging.session.bestNoReps' : 'logging.session.bestValue', {
                          weight: shownNumber(best.weightKg, unit),
                          reps: best.reps ?? 0,
                          date: new Date(best.achievedAt).toLocaleDateString(i18n.language, {
                            day: 'numeric',
                            month: 'short',
                          }),
                        })
                      : '—'
                  }
                />
              </Row>
            )}

            <View style={{ gap: 7 }}>
              {warmups.map(doneRow)}
              {workingSets.map(doneRow)}
              <SetRowView
                n={draft.isWarmup ? t('logging.session.warmupShort') : String(setNo)}
                weight={draft.weightKg === null ? '—' : shownNumber(draft.weightKg, unit)}
                reps={draft.reps === null ? '—' : String(draft.reps)}
                rpe={draft.rpe === null ? '—' : String(draft.rpe)}
                labels={{ weight: weightLabel, reps: t('logging.session.cellReps'), rpe: t('logging.session.rpe') }}
                state="current"
                onCell={openKeypad}
                cellA11y={{
                  weight: t('logging.session.weight'),
                  reps: t('logging.session.reps'),
                  rpe: t('logging.session.rpe'),
                }}
                a11yCheck={logLabel}
                onCheck={canLog ? () => void submitSet(null, draft) : undefined}
                // The PT is the one at arm's length with chalk on their hands; a
                // client self-logging types (spec §7.3). Voice needs a live session.
                onMic={viewerIsClient || !session ? undefined : () => setVoiceOpen(true)}
                micLabel={t('logging.voice.mic')}
              />
              {Array.from({ length: futureRows }, (_, i) => (
                <SetRowView
                  key={'planned-' + String(i)}
                  n={String(setNo + i + 1)}
                  weight={current.targetWeightKg === null ? '—' : shownNumber(current.targetWeightKg, unit)}
                  reps={reps === '' ? '—' : reps}
                  rpe={current.targetRpe === null ? '—' : String(current.targetRpe)}
                  labels={{ weight: weightLabel, reps: t('logging.session.cellReps'), rpe: t('logging.session.rpe') }}
                  state="planned"
                />
              ))}
            </View>

            {/* Warm-ups come before working sets; the artboard has no slot for
                marking one, so the toggle only shows until the first working set. */}
            {workingSets.length === 0 ? (
              <View style={{ marginTop: 10 }}>
                <Toggle
                  label={t('logging.session.warmup')}
                  value={draft.isWarmup}
                  onValueChange={(v) => setDraft((d) => ({ ...d, isWarmup: v }))}
                />
              </View>
            ) : null}

            {noteOpen ? (
              <View style={{ marginTop: 10 }}>
                <TextField
                  label={t('logging.session.note')}
                  placeholder={t('logging.session.notePlaceholder')}
                  value={draft.notes}
                  onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
                  maxLength={LOGGING_LIMITS.set_notes}
                />
              </View>
            ) : null}

            {rest.active ? (
              <View style={{ marginTop: 12 }}>
                <RestStrip
                  phase={rest.phase}
                  remaining={rest.remaining}
                  progress={rest.progress}
                  caption={restCaption}
                  plus30Label={t('logging.timer.plus30')}
                  skipLabel={t('logging.timer.skipShort')}
                  expandLabel={t('logging.session.openTimer')}
                  onExpand={() => setTimerOpen(true)}
                  onPlus30={rest.plus30}
                  onSkip={rest.clear}
                />
              </View>
            ) : null}

            {/* PT mode only: the client view "drops the editing affordances". */}
            {!viewerIsClient ? (
              <Row style={{ gap: 8, marginTop: 12 }}>
                <GhostTile label={t('logging.session.swap')} onPress={openPicker} />
                <GhostTile
                  label={noteOpen ? t('logging.session.hideNote') : t('logging.session.addNote')}
                  onPress={() => setNoteOpen((v) => !v)}
                />
              </Row>
            ) : null}
          </>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 18,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        {current ? (
          <Row style={{ justifyContent: 'space-between', marginBottom: 5 }}>
            <Pressable
              accessibilityRole="button"
              disabled={!next}
              onPress={() => setExerciseIndex(currentPos + 1)}
              style={{ flex: 1, minHeight: 36, justifyContent: 'center' }}
            >
              <Text numberOfLines={1} style={{ fontSize: 12.5, color: theme.colors.textMuted }}>
                {next ? t('logging.session.nextUp', { name: nameOf(next) }) : t('logging.session.lastExercise')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('logging.session.allExercises')}
              onPress={() => setListOpen(true)}
              style={{ minHeight: 36, paddingStart: 12, flexDirection: 'row', alignItems: 'center', gap: 4 }}
            >
              <Text numeric style={{ fontSize: 11.5, fontWeight: '700', color: theme.colors.textMuted }}>
                {t('logging.session.position', { n: currentPos + 1, total: exercises.length })}
              </Text>
              <Icon name="chevronDown" size={14} color={theme.colors.textMuted} />
            </Pressable>
          </Row>
        ) : null}
        <Row style={{ gap: 8 }}>
          {current ? (
            <View style={{ flex: 1 }}>
              <Button label={logLabel} size="lg" disabled={!canLog} onPress={() => void submitSet(null, draft)} />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Button label={t('logging.session.addExercise')} size="lg" disabled={pickerOff} onPress={openPicker} />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setFinishDraft(viewerIsClient ? '' : draftNote());
              setFinishOpen(true);
            }}
            style={({ pressed }) => ({
              minHeight: 56,
              paddingHorizontal: 16,
              borderRadius: 11,
              borderWidth: 1.5,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: theme.colors.textSecondary }}>
              {t('logging.session.end')}
            </Text>
          </Pressable>
        </Row>
      </View>

      {/* Exercise list sheet — the artboard's "2 OF 5" opens it. */}
      <Modal visible={listOpen} animationType="slide" transparent onRequestClose={() => setListOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => setListOpen(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
          />
          <View
            style={{
              padding: theme.space[4],
              paddingBottom: theme.space[6],
              gap: theme.space[2],
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              maxHeight: '80%',
            }}
          >
            <Text variant="h3" accessibilityRole="header">
              {t('logging.session.allExercises')}
            </Text>
            <ScrollView contentContainerStyle={{ gap: 6 }}>
              {exercises.map((ex, i) => {
                const n = workingCount(data.sets, ex.exerciseId);
                const complete = isExerciseDone(ex, data.sets);
                const selected = i === currentPos;
                return (
                  <Pressable
                    key={ex.exerciseId}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setExerciseIndex(i);
                      setListOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 52,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: selected ? theme.colors.accent : theme.colors.border,
                      backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
                    }}
                  >
                    <Text numeric style={{ width: 24, fontSize: 11, fontWeight: '700', color: theme.colors.accentText }}>
                      {ex.slot ?? '+'}
                    </Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: '600' }}>
                      {nameOf(ex)}
                    </Text>
                    <Text
                      numeric
                      style={{
                        fontSize: 12.5,
                        fontWeight: '700',
                        color: complete ? theme.colors.successAccent : theme.colors.textMuted,
                      }}
                    >
                      {ex.targetSets !== null ? `${n}/${ex.targetSets}` : String(n)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Button
              label={t('logging.session.addExercise')}
              variant="ghost"
              icon="plus"
              disabled={pickerOff}
              onPress={openPicker}
            />
          </View>
        </View>
      </Modal>

      <SessionSheets c={c} />

      <VoiceSheet
        visible={voiceOpen}
        setNumber={setNo}
        exerciseName={current ? nameOf(current) : null}
        unit={unit}
        language={i18n.language}
        online={offline.online}
        queued={offline.effective && !offline.online}
        onLog={logVoice}
        onClose={() => setVoiceOpen(false)}
      />
    </Screen>
  );
}

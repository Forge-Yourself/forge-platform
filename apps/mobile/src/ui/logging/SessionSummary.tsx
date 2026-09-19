import { formatElapsed, formatWeight, kgToDisplay, palette, sessionVolume } from '@forge/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { isExerciseDone, setsFor, workingCount } from '../../lib/logging/sessionModel';
import type { SetRow } from '../../lib/logging/sessionRpc';
import { nameOf, type SessionController } from '../../lib/logging/useSessionController';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { PrMoment } from '../PrMoment';
import { Row } from '../Row';
import { Screen } from '../Screen';
import { Text } from '../Text';
import { Kicker, SummaryStat } from './sessionParts';

/** Prototype `summary`: a completed session, for either persona (M4a spec §5.3). */
export function SessionSummary({ c }: { c: SessionController }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { session, data, exercises, unit, viewerIsClient, dayTitle, weightLabel, pr, setPr, buildPrView, goBack } = c;
  if (!session) return null;

  const working = data.sets.filter((s) => !s.is_warmup);
  const durationSec =
    session.started_at && session.completed_at
      ? Math.floor((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000)
      : null;
  const volumeKg = sessionVolume(data.sets);
  const note = viewerIsClient ? session.session_notes : session.pt_notes;
  const otherNote = viewerIsClient ? session.pt_notes : session.session_notes;
  const prSetIds = [...new Set(data.sessionPrs.map((p) => p.setId))];
  const firstPrSet = data.sets.find((s) => s.id === prSetIds[0]) ?? null;
  const firstPrExercise = firstPrSet ? exercises.find((e) => e.exerciseId === firstPrSet.exercise_id) : null;
  const done = exercises.filter((ex) => ex.programmed || workingCount(data.sets, ex.exerciseId) > 0);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 18, paddingBottom: 20 }}>
        <View style={{ alignItems: 'center', gap: 6, marginBottom: 22 }}>
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 19,
              backgroundColor: palette.success,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="check" size={28} color={palette.white} strokeWidth={2.6} />
          </View>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginTop: 6, textAlign: 'center' }}
          >
            {t('logging.summary.title')}
          </Text>
          <Text style={{ fontSize: 13.5, color: theme.colors.textSecondary, textAlign: 'center' }}>
            {viewerIsClient ? dayTitle : `${data.clientName ?? '—'} · ${dayTitle}`}
          </Text>
          {session.completed_at ? (
            <Text numeric style={{ fontSize: 12, color: theme.colors.textMuted }}>
              {new Date(session.completed_at).toLocaleString(i18n.language, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          ) : null}
        </View>

        <Row style={{ gap: 8, alignItems: 'stretch', marginBottom: 18 }}>
          <SummaryStat value={durationSec === null ? '—' : formatElapsed(durationSec)} label={t('logging.summary.durationK')} />
          <SummaryStat value={String(working.length)} label={t('logging.summary.setsK')} />
          <SummaryStat
            value={Math.round(kgToDisplay(volumeKg, unit)).toLocaleString(i18n.language)}
            label={t('logging.summary.volumeK', { unit: weightLabel })}
          />
        </Row>

        {firstPrSet && prSetIds.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setPr(
                buildPrView(
                  firstPrSet,
                  data.sessionPrs.filter((p) => p.setId === firstPrSet.id).map((p) => p.prType),
                  null,
                  firstPrExercise ? nameOf(firstPrExercise) : '',
                ),
              )
            }
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              paddingVertical: 14,
              paddingHorizontal: 13,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.accentSurfaceSoft,
              marginBottom: 20,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 9,
                backgroundColor: theme.colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="flame" size={15} color={theme.colors.onAccent} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '700', color: theme.colors.onAccentSurfaceSoft }}>
                {t('logging.pr.heading', { count: prSetIds.length })}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                {(firstPrExercise ? nameOf(firstPrExercise) + ' · ' : '') +
                  (firstPrSet.weight_kg === null
                    ? t('logging.session.repsOnly', { reps: firstPrSet.reps ?? 0 })
                    : t('logging.session.setSummary', {
                        weight: formatWeight(firstPrSet.weight_kg, unit),
                        reps: firstPrSet.reps ?? 0,
                      }))}
              </Text>
            </View>
            <Icon name="chevron" size={16} color={theme.colors.onAccentSurfaceSoft} />
          </Pressable>
        ) : null}

        <Kicker>{t('logging.summary.whatWasDone')}</Kicker>
        {done.length === 0 ? (
          <Text tone="secondary" style={{ marginBottom: 20 }}>
            {t('logging.summary.noSets')}
          </Text>
        ) : (
          <View
            style={{
              gap: 1,
              backgroundColor: theme.colors.border,
              borderRadius: 12,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: theme.colors.border,
              marginBottom: 20,
            }}
          >
            {done.map((ex) => {
              const rows = setsFor(data.sets, ex.exerciseId).filter((s) => !s.is_warmup);
              const complete = isExerciseDone(ex, data.sets);
              const top = rows.reduce<SetRow | null>(
                (best, s) => (best === null || (s.weight_kg ?? 0) > (best.weight_kg ?? 0) ? s : best),
                null,
              );
              const spec = rows.length === 0
                ? t('logging.summary.specSkipped')
                : !complete
                ? t('logging.summary.specPartial', { done: rows.length, total: ex.targetSets ?? rows.length })
                : top?.weight_kg !== null && top?.weight_kg !== undefined
                  ? t('logging.summary.specDone', {
                      sets: rows.length,
                      reps: top.reps ?? 0,
                      weight: formatWeight(top.weight_kg, unit),
                    })
                  : t('logging.summary.specDoneNoWeight', { sets: rows.length, reps: top?.reps ?? 0 });
              return (
                <Row
                  key={ex.exerciseId}
                  style={{ gap: 10, paddingVertical: 12, paddingHorizontal: 13, backgroundColor: theme.colors.surfaceRaised }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      backgroundColor: complete ? palette.success : theme.colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {complete ? (
                      <Icon name="check" size={12} color={palette.white} strokeWidth={2.8} />
                    ) : (
                      <Icon name="minus" size={12} color={theme.colors.textSecondary} strokeWidth={2.4} />
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontWeight: '600' }}>
                    {nameOf(ex)}
                  </Text>
                  <Text numeric style={{ fontSize: 12.5, color: theme.colors.textSecondary }}>
                    {spec}
                  </Text>
                </Row>
              );
            })}
          </View>
        )}

        {note || otherNote || session.rating !== null ? (
          <>
            <Kicker>
              {viewerIsClient || !data.clientName
                ? t('logging.summary.notes')
                : t('logging.summary.noteFor', { name: data.clientName.split(' ')[0] })}
            </Kicker>
            <View
              style={{
                minHeight: 76,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceRaised,
                gap: 8,
              }}
            >
              {note ? (
                <Text style={{ fontSize: 13.5, lineHeight: 21, color: theme.colors.textSecondary }}>{note}</Text>
              ) : null}
              {otherNote ? (
                <Text style={{ fontSize: 13.5, lineHeight: 21, color: theme.colors.textSecondary }}>
                  {otherNote}
                </Text>
              ) : null}
              {session.rating !== null ? (
                <Text
                  numeric
                  accessibilityLabel={t('logging.summary.ratingA11y', { rating: session.rating })}
                  style={{ color: theme.colors.accentText }}
                >
                  {'●'.repeat(session.rating)}
                  {'○'.repeat(5 - session.rating)}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* The artboard's "Send summary to <client>" is M9 comms; until then Done is
          the one exit, pinned rather than at the end of the scroll (PITFALLS N2). */}
      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 10,
          paddingBottom: 18,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}
      >
        <Button label={t('common.done')} size="lg" onPress={goBack} />
      </View>

      {pr ? (
        <PrMoment
          visible
          kicker={t('logging.pr.kicker')}
          {...pr}
          keepGoingLabel={t('common.done')}
          onClose={() => setPr(null)}
        />
      ) : null}
    </Screen>
  );
}

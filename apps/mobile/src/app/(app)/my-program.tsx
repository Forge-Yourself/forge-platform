import { programStats, weekCompletion } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { blockTag, formatRepsCell, formatRest, slotFor } from '../../lib/programs/draftModel';
import { useProgramTree } from '../../lib/programs/useProgramTree';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, BuilderBlock, BuilderRow, Button, Row, Screen, Skeleton, Text } from '../../ui';

/**
 * The client's read-only view of the program assigned to them.
 *
 * It calls the same program_tree() RPC through the same hook the PT's builder
 * uses. That is deliberate: program_tree is invoker-rights, so RLS
 * (is_program_visible) is the single authorization path for both, and there
 * is no second code path that could drift from it. A draft never reaches this
 * screen because the policy will not return one, not because this screen
 * filters for it.
 *
 * BuilderRow renders read-only here — no onCellPress — so the numbers read
 * exactly as the PT typed them while nothing is tappable, and a screen reader
 * announces values rather than buttons that do nothing.
 */
export default function MyProgram() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const { loading, error, tree, refetch } = useProgramTree(params.id);

  const [weekIndex, setWeekIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);

  if (loading) {
    return (
      <Screen>
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={32} />
          <Skeleton height={44} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  if (error || !tree) {
    return (
      <Screen>
        <View style={{ gap: theme.space[3] }}>
          <Text variant="h2">{t('myProgram.offlineError.title')}</Text>
          <Banner variant="danger" message={t('myProgram.offlineError.body')} />
          <Button label={t('myProgram.offlineError.retry')} variant="ghost" onPress={() => void refetch()} />
          <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const stats = programStats(tree);
  const { currentWeek } = weekCompletion(
    { duration_weeks: tree.duration_weeks, start_date: tree.start_date },
    new Date(),
  );
  const week = tree.weeks[weekIndex];
  const day = week?.days[dayIndex];

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Button label={t('common.back')} variant="ghost" onPress={() => router.back()} />
        <Text variant="h3" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {tree.name}
        </Text>
        <View style={{ width: 64 }} />
      </Row>

      <Text tone="secondary" style={{ marginTop: theme.space[2] }}>
        {t('programs.meta', {
          weeks: stats.weeks,
          days: stats.daysPerWeek,
          exercises: stats.exerciseCount,
        })}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.space[2], paddingVertical: theme.space[3] }}
      >
        {tree.weeks.map((w, wi) => {
          const selected = wi === weekIndex;
          const isCurrent = w.week_number === currentWeek;
          return (
            <Pressable
              key={w.id}
              accessibilityRole="button"
              accessibilityLabel={t('builder.weekLabel', { week: w.week_number })}
              accessibilityState={{ selected }}
              onPress={() => {
                setWeekIndex(wi);
                setDayIndex(0);
              }}
              style={{
                minWidth: 44,
                minHeight: 38,
                paddingHorizontal: theme.space[3],
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radius.pill,
                borderWidth: isCurrent ? 1.5 : 1,
                borderColor: selected || isCurrent ? theme.colors.accent : theme.colors.border,
                backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
              }}
            >
              <Text numeric variant="caption" style={{ fontWeight: '700' }}>
                {w.week_number}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: theme.space[2], paddingBottom: theme.space[3] }}
      >
        {(week?.days ?? []).map((d, di) => {
          const selected = di === dayIndex;
          return (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={t('builder.dayLabel', { day: d.day_number })}
              accessibilityState={{ selected }}
              onPress={() => setDayIndex(di)}
              style={{
                minHeight: 38,
                paddingHorizontal: theme.space[3],
                justifyContent: 'center',
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: selected ? theme.colors.accent : theme.colors.border,
                backgroundColor: selected ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
              }}
            >
              <Text variant="caption" style={{ fontWeight: '600' }}>
                {d.label ?? t('builder.dayLabel', { day: d.day_number })}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ gap: theme.space[3], paddingBottom: theme.space[8] }}>
        {day === undefined || day.blocks.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: theme.space[8], gap: theme.space[2] }}>
            <Text variant="h3">{t('builder.empty.title')}</Text>
          </View>
        ) : (
          day.blocks.map((block, blockIndex) => (
            <BuilderBlock
              key={block.id}
              tag={blockTag(blockIndex)}
              title={block.label ?? t('builder.blockTypeLabels.' + block.block_type)}
              rest={
                block.rest_between_sec === null
                  ? null
                  : t('builder.restLabel', { rest: formatRest(block.rest_between_sec) })
              }
            >
              {block.exercises.map((exercise, rowIndex) => (
                <BuilderRow
                  key={exercise.id}
                  slot={slotFor(blockIndex, rowIndex)}
                  name={exercise.exercise_name}
                  cells={[
                    {
                      key: 'sets',
                      label: t('builder.cells.sets'),
                      value: exercise.target_sets === null ? '' : String(exercise.target_sets),
                    },
                    {
                      key: 'reps',
                      label: t('builder.cells.reps'),
                      value: formatRepsCell(exercise.target_reps_min, exercise.target_reps_max),
                    },
                    {
                      key: 'rpe',
                      label: t('builder.cells.rpe'),
                      value: exercise.target_rpe === null ? '' : String(exercise.target_rpe),
                    },
                    {
                      key: 'tempo',
                      label: t('builder.cells.tempo'),
                      value: exercise.tempo_prescribed ?? '',
                    },
                  ]}
                />
              ))}
            </BuilderBlock>
          ))
        )}

        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {t('myProgram.readOnlyNote')}
        </Text>
      </ScrollView>
    </Screen>
  );
}

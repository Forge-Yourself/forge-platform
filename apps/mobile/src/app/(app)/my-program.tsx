import { programStats, weekCompletion } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { blockTag, formatRepsCell, formatRest, slotFor } from '../../lib/programs/draftModel';
import { useProgramTree } from '../../lib/programs/useProgramTree';
import { useTheme } from '../../theme/ThemeProvider';
import {
  Banner,
  BuilderBlock,
  BuilderRow,
  Button,
  NavHeader,
  Screen,
  Skeleton,
  Tag,
  Text,
  WeekDayNav,
} from '../../ui';

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

  const back = (
    <Button label={t('common.back')} icon="chevronBack" variant="link" onPress={() => router.back()} />
  );

  if (loading) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Skeleton height={32} />
          <Skeleton height={44} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  if (error || !tree) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} divider={false} />
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Text variant="h2">{t('myProgram.offlineError.title')}</Text>
          <Banner variant="danger" message={t('myProgram.offlineError.body')} />
          <Button label={t('myProgram.offlineError.retry')} variant="ghost" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const stats = programStats(tree);
  const { currentWeek, weeks: weekProgress } = weekCompletion(
    { duration_weeks: tree.duration_weeks, start_date: tree.start_date },
    new Date(),
  );
  const week = tree.weeks[weekIndex];
  const day = week?.days[dayIndex];

  return (
    <Screen padded={false}>
      <NavHeader
        leading={back}
        title={tree.name}
        trailing={
          currentWeek === null ? undefined : (
            <Tag numeric tone="accent" label={t('programs.weekTag', { week: currentWeek })} />
          )
        }
      />

      {/* The week chips carry the elapsed/live progress the WeekStrip used to draw
          above them, so this screen no longer states the same thing twice. */}
      <WeekDayNav
        weeks={tree.weeks.map((w) => ({
          key: w.id,
          number: w.week_number,
          state: weekProgress.find((p) => p.weekNumber === w.week_number)?.state ?? 'upcoming',
          a11yLabel: t('builder.weekLabel', { week: w.week_number }),
        }))}
        weekIndex={weekIndex}
        onSelectWeek={(wi) => {
          setWeekIndex(wi);
          setDayIndex(0);
        }}
        days={(week?.days ?? []).map((d) => ({
          key: d.id,
          label: d.label ?? t('builder.dayLabel', { day: d.day_number }),
          a11yLabel: t('builder.dayLabel', { day: d.day_number }),
        }))}
        dayIndex={dayIndex}
        onSelectDay={setDayIndex}
        meta={t('programs.meta', {
          weeks: stats.weeks,
          days: stats.daysPerWeek,
          exercises: stats.exerciseCount,
        })}
      />

      <ScrollView
        contentContainerStyle={{
          gap: theme.space[3],
          paddingHorizontal: theme.space[4],
          paddingTop: theme.space[3],
          paddingBottom: theme.space[8],
        }}
      >
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

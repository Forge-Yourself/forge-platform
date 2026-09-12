import { weekCompletion, type WeekProgressState } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, View } from 'react-native';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { createProgram } from '../../../lib/programs/programActions';
import {
  useProgramList,
  type ProgramListItem,
  type ProgramListTab,
} from '../../../lib/programs/useProgramList';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  ListRow,
  Row,
  Screen,
  SectionCard,
  SegmentedPill,
  Skeleton,
  Text,
  TextField,
  Toggle,
} from '../../../ui';

const WEEK_OPTIONS = [4, 6, 8, 12];

/**
 * The week strip under an assigned program: filled bars for weeks that have
 * passed, an outlined one for the live week. Mono bars, no percentages — the
 * annotation is explicit that this is a glance, not a metric.
 */
function WeekStrip({ program }: { program: ProgramListItem }) {
  const theme = useTheme();
  const { weeks } = weekCompletion(
    { duration_weeks: program.duration_weeks, start_date: program.start_date },
    new Date(),
  );

  const colorFor = (state: WeekProgressState) => {
    if (state === 'done') return theme.colors.accent;
    if (state === 'current') return theme.colors.accentSurfaceSoft;
    return theme.colors.surfaceSunken;
  };

  return (
    <View style={{ flexDirection: 'row', gap: 3, marginTop: 6 }}>
      {weeks.map((week) => (
        <View
          key={week.weekNumber}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: colorFor(week.state),
            borderWidth: week.state === 'current' ? 1 : 0,
            borderColor: theme.colors.accent,
          }}
        />
      ))}
    </View>
  );
}

/**
 * Program and template lists. Assigned | Templates is one route behind a
 * SegmentedPill, not two routes, per the annotation. Templates carry an
 * inline Assign because that is the only thing a PT does from that list.
 */
export default function ProgramsIndex() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [tab, setTab] = useState<ProgramListTab>('assigned');
  const { loading, error, items, isEmpty, refetch } = useProgramList(tab);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [asTemplate, setAsTemplate] = useState(false);
  const { submitting, error: createError, setError, run } = useAsyncSubmit();

  async function handleCreate() {
    setError(null);
    if (name.trim() === '') return;
    await run(async () => {
      try {
        const id = await createProgram(name.trim(), weeks, undefined, asTemplate);
        setCreateOpen(false);
        setName('');
        await refetch();
        router.push({ pathname: '/(app)/programs/[id]/builder', params: { id } });
      } catch {
        setError(t('programs.create.error'));
      }
    });
  }

  const metaFor = (program: ProgramListItem) =>
    t('programs.meta', {
      weeks: program.duration_weeks,
      days: program.days_per_week,
      exercises: program.exercise_count,
    });

  const tagFor = (program: ProgramListItem) => {
    if (program.is_ai_generated && program.state === 'draft') return t('programs.draftTag');
    if (program.state === 'draft') return t('programs.draftTag');
    const { currentWeek } = weekCompletion(
      { duration_weeks: program.duration_weeks, start_date: program.start_date },
      new Date(),
    );
    return currentWeek === null ? null : t('programs.weekTag', { week: currentWeek });
  };

  const emptyCopy = tab === 'templates' ? 'programs.emptyTemplates' : 'programs.empty';

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">{t('programs.title')}</Text>
          <Button label={t('programs.newProgram')} onPress={() => setCreateOpen(true)} />
        </Row>

        <SegmentedPill
          items={[
            { value: 'assigned', label: t('programs.tabs.assigned') },
            { value: 'templates', label: t('programs.tabs.templates') },
          ]}
          selected={tab}
          onChange={(v) => setTab(v as ProgramListTab)}
        />

        {loading ? (
          <SectionCard>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </SectionCard>
        ) : error ? (
          <View style={{ gap: theme.space[3] }}>
            <Banner variant="danger" message={t('programs.offlineError.body')} />
            <Button
              label={t('programs.offlineError.retry')}
              variant="ghost"
              onPress={() => void refetch()}
            />
          </View>
        ) : isEmpty ? (
          <View style={{ gap: theme.space[3], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Text variant="h3">{t(emptyCopy + '.title')}</Text>
            <Text tone="secondary">{t(emptyCopy + '.body')}</Text>
            <Button label={t(emptyCopy + '.createButton')} onPress={() => setCreateOpen(true)} />
          </View>
        ) : (
          <SectionCard>
            {items.map((program) => {
              const tag = tagFor(program);
              return (
                <ListRow
                  key={program.id}
                  minHeight={72}
                  title={program.clientName ? program.name + ' · ' + program.clientName : program.name}
                  subtitle={
                    program.is_ai_generated && program.state === 'draft'
                      ? t('programs.aiDraftMeta', { weeks: program.duration_weeks })
                      : metaFor(program)
                  }
                  trailing={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {tag ? (
                        <View
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: theme.radius.sm,
                            backgroundColor:
                              program.state === 'draft'
                                ? theme.colors.warnSurface
                                : theme.colors.surfaceSunken,
                          }}
                        >
                          <Text
                            numeric
                            variant="caption"
                            style={{
                              fontWeight: '700',
                              color:
                                program.state === 'draft'
                                  ? theme.colors.onWarnSurface
                                  : theme.colors.textSecondary,
                            }}
                          >
                            {tag}
                          </Text>
                        </View>
                      ) : null}
                      {tab === 'templates' ? (
                        <Button
                          label={t('programs.assignAction')}
                          variant="ghost"
                          onPress={() =>
                            router.push({
                              pathname: '/(app)/programs/[id]/assign',
                              params: { id: program.id, template: '1' },
                            })
                          }
                        />
                      ) : null}
                    </View>
                  }
                  onPress={() =>
                    router.push({ pathname: '/(app)/programs/[id]/builder', params: { id: program.id } })
                  }
                />
              );
            })}
          </SectionCard>
        )}

        {tab === 'assigned' && !loading && !error && !isEmpty ? (
          <View style={{ gap: theme.space[2] }}>
            {items
              .filter((p) => p.state === 'active')
              .map((program) => (
                <View key={program.id}>
                  <Text variant="caption" tone="muted">
                    {program.name}
                  </Text>
                  <WeekStrip program={program} />
                </View>
              ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={createOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCreateOpen(false)}
      >
        <Screen>
          <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
            <Text variant="h2">{t('programs.create.title')}</Text>

            {createError ? <Banner variant="danger" message={createError} /> : null}

            <TextField
              label={t('programs.create.nameLabel')}
              placeholder={t('programs.create.namePlaceholder')}
              value={name}
              onChangeText={setName}
            />

            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" tone="muted">
                {t('programs.create.weeksLabel')}
              </Text>
              <SegmentedPill
                items={WEEK_OPTIONS.map((w) => ({
                  value: String(w),
                  label: t('programs.create.weeksValue', { count: w }),
                }))}
                selected={String(weeks)}
                onChange={(v) => setWeeks(Number(v))}
              />
            </View>

            <Toggle
              label={t('programs.create.templateLabel')}
              value={asTemplate}
              onValueChange={setAsTemplate}
            />

            <Button
              label={t('programs.create.create')}
              size="lg"
              disabled={submitting || name.trim() === ''}
              onPress={() => void handleCreate()}
            />
            <Button label={t('common.cancel')} variant="ghost" onPress={() => setCreateOpen(false)} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}

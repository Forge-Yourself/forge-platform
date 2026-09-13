import { weekCompletion } from '@forge/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useAsyncSubmit } from '../../../lib/forms/useAsyncSubmit';
import { createProgram } from '../../../lib/programs/programActions';
import {
  useProgramList,
  type ProgramListItem,
  type ProgramListTab,
} from '../../../lib/programs/useProgramList';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  IconButton,
  NavHeader,
  Row,
  Screen,
  ScreenHeader,
  SectionLabel,
  SegmentedPill,
  Skeleton,
  Tag,
  Text,
  TextField,
  Toggle,
  WeekStrip,
  type TagTone,
} from '../../../ui';

const WEEK_OPTIONS = [4, 6, 8, 12];

/**
 * An assigned program, drawn as a card rather than a list row.
 *
 * The week strip belongs here, inside the card it describes. It used to render as
 * a second, detached list below the roster — every program's name repeated once
 * more above a bar row with no visual tie to the card it summarised.
 */
function ProgramCard({ program }: { program: ProgramListItem }) {
  const { t } = useTranslation();
  const theme = useTheme();

  const isDraft = program.state === 'draft';
  const { weeks, currentWeek } = weekCompletion(
    { duration_weeks: program.duration_weeks, start_date: program.start_date },
    new Date(),
  );

  const tag: { label: string; tone: TagTone } | null = isDraft
    ? { label: t('programs.draftTag'), tone: 'warn' }
    : currentWeek === null
      ? null
      : { label: t('programs.weekTag', { week: currentWeek }), tone: 'accent' };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={program.name}
      onPress={() =>
        router.push({ pathname: '/(app)/programs/[id]/builder', params: { id: program.id } })
      }
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ gap: theme.space[2], padding: 15 }}>
        <Row style={{ gap: theme.space[3] }}>
          <Avatar name={program.clientName ?? '—'} size={34} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700' }}>
              {program.name}
            </Text>
            <Text numberOfLines={1} tone="muted" style={{ fontSize: 12.5 }}>
              {program.clientName ?? t('programs.unassigned')}
            </Text>
          </View>
          {tag ? <Tag label={tag.label} tone={tag.tone} numeric={!isDraft} /> : null}
        </Row>

        {isDraft ? null : (
          <WeekStrip
            weeks={weeks}
            label={t('clientHome.program.weekOf', {
              week: currentWeek ?? 1,
              total: program.duration_weeks,
            })}
          />
        )}

        <Text numeric tone="muted" style={{ fontSize: 11.5 }}>
          {program.is_ai_generated && isDraft
            ? t('programs.aiDraftMeta', { weeks: program.duration_weeks })
            : t('programs.meta', {
                weeks: program.duration_weeks,
                days: program.days_per_week,
                exercises: program.exercise_count,
              })}
        </Text>
      </Card>
    </Pressable>
  );
}

/**
 * A template. No week strip and no client — a template is not running anywhere.
 * Assign is inline because, per the design annotation, it is the only thing a PT
 * does from this list.
 */
function TemplateCard({ program }: { program: ProgramListItem }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Card style={{ gap: theme.space[2], padding: 15 }}>
      <Row style={{ gap: theme.space[3] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={program.name}
          onPress={() =>
            router.push({ pathname: '/(app)/programs/[id]/builder', params: { id: program.id } })
          }
          style={{ flex: 1, gap: 2 }}
        >
          <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '700' }}>
            {program.name}
          </Text>
          <Text numeric tone="muted" style={{ fontSize: 11.5 }}>
            {t('programs.meta', {
              weeks: program.duration_weeks,
              days: program.days_per_week,
              exercises: program.exercise_count,
            })}
          </Text>
        </Pressable>
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
      </Row>
      {program.description ? (
        <Text tone="secondary" style={{ fontSize: 12.5, lineHeight: 19 }}>
          {program.description}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Program and template lists. Assigned | Templates is one route behind a
 * SegmentedPill, not two routes, per the annotation.
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

  const emptyCopy = tab === 'templates' ? 'programs.emptyTemplates' : 'programs.empty';

  return (
    <Screen padded={false}>
      <ScreenHeader
        title={t('programs.title')}
        action={
          <IconButton
            icon="plus"
            accessibilityLabel={t('programs.newProgram')}
            onPress={() => setCreateOpen(true)}
          />
        }
      >
        <SegmentedPill
          items={[
            { value: 'assigned', label: t('programs.tabs.assigned') },
            { value: 'templates', label: t('programs.tabs.templates') },
          ]}
          selected={tab}
          onChange={(v) => setTab(v as ProgramListTab)}
        />
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[6],
          gap: 9,
        }}
      >
        {loading ? (
          <>
            <Skeleton height={104} radius={theme.radius.lg} />
            <Skeleton height={104} radius={theme.radius.lg} />
            <Skeleton height={104} radius={theme.radius.lg} />
          </>
        ) : error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('programs.offlineError.title')}
            body={t('programs.offlineError.body')}
            actionLabel={t('programs.offlineError.retry')}
            actionVariant="ghost"
            onAction={() => void refetch()}
          />
        ) : isEmpty ? (
          <EmptyState
            icon="calendar"
            title={t(emptyCopy + '.title')}
            body={t(emptyCopy + '.body')}
            actionLabel={t(emptyCopy + '.createButton')}
            onAction={() => setCreateOpen(true)}
          />
        ) : (
          items.map((program) =>
            tab === 'templates' ? (
              <TemplateCard key={program.id} program={program} />
            ) : (
              <ProgramCard key={program.id} program={program} />
            ),
          )
        )}
      </ScrollView>

      <Modal
        visible={createOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCreateOpen(false)}
      >
        <Screen padded={false}>
          <NavHeader
            title={t('programs.create.title')}
            leading={
              <Button label={t('common.cancel')} variant="link" onPress={() => setCreateOpen(false)} />
            }
          />
          <ScrollView
            contentContainerStyle={{ padding: theme.space[5], gap: theme.space[4] }}
            keyboardShouldPersistTaps="handled"
          >
            {createError ? <Banner variant="danger" message={createError} /> : null}

            <TextField
              label={t('programs.create.nameLabel')}
              placeholder={t('programs.create.namePlaceholder')}
              value={name}
              onChangeText={setName}
              autoFocus
            />

            <View style={{ gap: theme.space[2] }}>
              <SectionLabel>{t('programs.create.weeksLabel')}</SectionLabel>
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
          </ScrollView>
          <View style={{ padding: theme.space[5], paddingTop: theme.space[3] }}>
            <Button
              label={t('programs.create.create')}
              size="lg"
              loading={submitting}
              disabled={name.trim() === ''}
              onPress={() => void handleCreate()}
            />
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

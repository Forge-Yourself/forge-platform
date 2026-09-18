import { programTreeSchema, weekCompletion, type ProgramTree } from '@forge/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Banner, Button, ListRow, SectionCard, SectionLabel, Skeleton, Tag, Text, TextLink } from '../../ui';
import { supabase } from '../supabase';
import { startWorkoutSession } from './sessionRpc';

export type StartSessionSheetProps = {
  visible: boolean;
  clientId: string;
  /** The PT sees an "assign one" link when no program exists; the client sees a sentence. */
  viewerIsPt: boolean;
  onDismiss: () => void;
};

type DayOption = { id: string; dayNumber: number; label: string | null; done: boolean };
type Loaded = { program: ProgramTree | null; week: number; days: DayOption[] };

const EMPTY: Loaded = { program: null, week: 1, days: [] };

async function loadWeek(clientId: string): Promise<Loaded> {
  const { data: active } = await supabase
    .from('programs')
    .select('id, duration_weeks, start_date')
    .eq('client_id', clientId)
    .eq('state', 'active')
    .maybeSingle();
  if (!active) return EMPTY;
  const { data: raw } = await supabase.rpc('program_tree', { p_program_id: active.id });
  const parsed = programTreeSchema.safeParse(raw);
  if (!parsed.success) return EMPTY;
  const current = weekCompletion({ duration_weeks: active.duration_weeks, start_date: active.start_date }).currentWeek ?? 1;
  const weekNode = parsed.data.weeks.find((w) => w.week_number === current) ?? parsed.data.weeks[0];
  const dayIds = (weekNode?.days ?? []).map((d) => d.id);
  let doneIds = new Set<string>();
  if (dayIds.length > 0) {
    const { data: done } = await supabase
      .from('workout_sessions')
      .select('program_day_id')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .in('program_day_id', dayIds);
    doneIds = new Set((done ?? []).map((r) => r.program_day_id).filter((id): id is string => id !== null));
  }
  return {
    program: parsed.data,
    week: weekNode?.week_number ?? current,
    days: (weekNode?.days ?? []).map((d) => ({ id: d.id, dayNumber: d.day_number, label: d.label, done: doneIds.has(d.id) })),
  };
}

/**
 * Spec §5.2. Lists the active program's days for the current week with a DONE
 * tag where a completed session already points at the day, pre-highlights the
 * first open one, and always offers Freestyle. Start replaces the route (N3);
 * an existing in-progress session is a resume, not an error.
 */
export function StartSessionSheet({ visible, clientId, viewerIsPt, onDismiss }: StartSessionSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [selected, setSelected] = useState<string | 'freestyle' | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void loadWeek(clientId).then((r) => {
      if (cancelled) return;
      setLoaded(r);
      setSelected(r.days.find((d) => !d.done)?.id ?? r.days[0]?.id ?? 'freestyle');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, clientId]);

  async function start() {
    if (!selected) return;
    setStarting(true);
    setError(null);
    const { session, error: err } = await startWorkoutSession(clientId, selected === 'freestyle' ? null : selected);
    setStarting(false);
    if (err || !session) {
      setError(t('logging.start.error'));
      return;
    }
    onDismiss();
    router.replace({ pathname: '/(app)/sessions/[id]', params: { id: session.id } });
  }

  const marker = <Tag label="●" tone="accent" />;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
          onPress={onDismiss}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View
          style={{
            padding: theme.space[5],
            gap: theme.space[3],
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
          }}
        >
          <Text variant="h3">{t('logging.start.title')}</Text>
          {error ? <Banner variant="danger" message={error} /> : null}
          {loading ? (
            <Skeleton height={68} />
          ) : (
            <>
              {loaded.program ? (
                <View style={{ gap: theme.space[2] }}>
                  <SectionLabel>{t('logging.start.weekOf', { week: loaded.week, total: loaded.program.duration_weeks })}</SectionLabel>
                  <SectionCard>
                    {loaded.days.map((d) => (
                      <ListRow
                        key={d.id}
                        title={d.label ?? t('logging.start.dayRow', { day: d.dayNumber })}
                        subtitle={d.label ? t('logging.start.dayRow', { day: d.dayNumber }) : undefined}
                        trailing={d.done ? <Tag label={t('logging.start.done')} tone="success" /> : selected === d.id ? marker : undefined}
                        chevron={false}
                        onPress={() => setSelected(d.id)}
                      />
                    ))}
                  </SectionCard>
                </View>
              ) : viewerIsPt ? (
                <TextLink
                  prefix={t('logging.start.noProgramPt')}
                  action={t('logging.start.noProgramPtLink')}
                  onPress={() => {
                    onDismiss();
                    router.push('/(app)/(tabs)/programs');
                  }}
                />
              ) : (
                <Text tone="secondary">{t('logging.start.noProgramClient')}</Text>
              )}
              <SectionCard>
                <ListRow
                  title={t('logging.start.freestyle')}
                  subtitle={t('logging.start.freestyleBody')}
                  trailing={selected === 'freestyle' ? marker : undefined}
                  chevron={false}
                  onPress={() => setSelected('freestyle')}
                  isLast
                />
              </SectionCard>
            </>
          )}
          <Button
            label={t('logging.start.title')}
            size="lg"
            loading={starting}
            disabled={loading || !selected}
            onPress={() => void start()}
          />
          <Button label={t('common.cancel')} variant="link" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

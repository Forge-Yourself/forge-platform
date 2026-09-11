import type { Database, IntakeResponses } from '@forge/shared';
import { INTAKE_TEMPLATE_V1, PARQ_QUESTIONS } from '@forge/shared';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { supabase } from '../../../../lib/supabase';
import { useTheme } from '../../../../theme/ThemeProvider';
import { Banner, Row, Screen, SectionCard, Spinner, Text } from '../../../../ui';

type IntakeFormRow = Database['public']['Tables']['intake_forms']['Row'];

type State = {
  loading: boolean;
  intake: IntakeFormRow | null;
};

/**
 * PT intake review — single screen, no tabs. Flagged PAR-Q answers get a
 * danger fill with a 4px leading bar via `insetInlineStart` (mirrors under
 * RTL, matching `TextField`'s `insetInlineEnd` precedent — never hardcode
 * `left`). Reached only once RLS actually allows the read (`completed` or
 * later); a stale link to a still-pending intake renders a clear
 * not-submitted state instead of an empty screen.
 */
export default function IntakeReview() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState<State>({ loading: true, intake: null });

  useEffect(() => {
    let cancelled = false;
    if (!params.id) {
      void Promise.resolve().then(() => {
        if (!cancelled) setState({ loading: false, intake: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void supabase
      .from('intake_forms')
      .select('*')
      .eq('client_id', params.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setState({ loading: false, intake: data ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (state.loading) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  if (!state.intake) {
    return (
      <Screen>
        <Banner variant="info" message={t('intake.review.notSubmittedYet')} />
      </Screen>
    );
  }

  const responses = (state.intake.responses ?? {}) as Partial<IntakeResponses>;
  const flags = new Set((state.intake.red_flags as string[] | null) ?? []);

  function labelValueRows(sectionId: string): { label: string; value: string }[] {
    const section = (responses as Record<string, Record<string, unknown> | undefined>)[sectionId];
    if (!section) return [];
    return Object.entries(section)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([key, value]) => ({
        label: t(`intake.${sectionId}.${camelLabelKey(key)}`, { defaultValue: key }),
        value: Array.isArray(value) ? value.join(', ') : String(value),
      }));
  }

  function camelLabelKey(snakeKey: string): string {
    // e.g. primary_goal -> primaryGoalLabel, matching this milestone's i18n key convention.
    const camel = snakeKey.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return `${camel}Label`;
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="h1">{t('intake.review.title')}</Text>

        <SectionCard>
          {PARQ_QUESTIONS.map((q, i) => {
            const isFlagged = flags.has(q);
            const value = (responses.parq as Record<string, boolean> | undefined)?.[q];
            return (
              <View
                key={q}
                style={{
                  position: 'relative',
                  paddingInlineStart: isFlagged ? theme.space[4] : theme.space[4],
                  backgroundColor: isFlagged ? theme.colors.dangerSurface : 'transparent',
                  borderBottomWidth: i === PARQ_QUESTIONS.length - 1 ? 0 : 1,
                  borderBottomColor: theme.colors.border,
                  paddingVertical: theme.space[3],
                }}
              >
                {isFlagged ? (
                  <View
                    style={{
                      position: 'absolute',
                      insetInlineStart: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      backgroundColor: theme.colors.dangerAccent,
                    }}
                  />
                ) : null}
                <Text tone={isFlagged ? undefined : 'secondary'} style={isFlagged ? { color: theme.colors.onDangerSurface } : undefined}>
                  {t(`intake.parq.${q}`)}
                </Text>
                <Text variant="bodyBold" style={isFlagged ? { color: theme.colors.onDangerSurface } : undefined}>
                  {value === true ? t('intake.parq.yes') : value === false ? t('intake.parq.no') : '—'}
                </Text>
                {isFlagged ? (
                  <Text variant="caption" style={{ color: theme.colors.onDangerSurface, marginTop: 2 }}>
                    {t('intake.review.flaggedLabel')}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </SectionCard>

        {INTAKE_TEMPLATE_V1.filter((s) => s.id !== 'parq').map((section) => {
          const rows = labelValueRows(section.id);
          if (rows.length === 0) return null;
          return (
            <View key={section.id} style={{ gap: theme.space[2] }}>
              <Text variant="label" tone="muted">
                {t(`intake.steps.${section.id}`)}
              </Text>
              <SectionCard>
                {rows.map((row, i) => (
                  <Row key={row.label} style={{ justifyContent: 'space-between', padding: theme.space[3], borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: theme.colors.border }}>
                    <Text tone="secondary">{row.label}</Text>
                    <Text style={{ flex: 1, textAlign: 'right' }}>{row.value}</Text>
                  </Row>
                ))}
              </SectionCard>
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

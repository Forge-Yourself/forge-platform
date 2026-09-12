import { weekCompletion } from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { useClientList } from '../../../../lib/clients/useClientList';
import { useAsyncSubmit } from '../../../../lib/forms/useAsyncSubmit';
import { assignProgram, instantiateTemplate } from '../../../../lib/programs/programActions';
import { useProgramList } from '../../../../lib/programs/useProgramList';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  ListRow,
  Row,
  Screen,
  SectionCard,
  Skeleton,
  Text,
  TextField,
} from '../../../../ui';

type StartChoice = 'nextMonday' | 'today' | 'custom';

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextMonday(from: Date): Date {
  const date = new Date(from);
  const daysAhead = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + daysAhead);
  return date;
}

/**
 * Assign a program (or instantiate a template) to one or more clients.
 *
 * Start date is two taps, not a calendar: Next Monday is the default because
 * that is when programs actually start, and only "Pick a date" opens a field.
 *
 * The replace warning is shown before the tap, never after — assign_program
 * archives whatever was active for that client in the same transaction, and
 * the PT needs to know that while they can still change their mind.
 */
export default function AssignProgram() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ id: string; template?: string }>();
  const isTemplate = params.template === '1';

  const clients = useClientList(auth.user?.id, '', 'active');
  const programs = useProgramList('assigned');

  const [selected, setSelected] = useState<string[]>([]);
  const [startChoice, setStartChoice] = useState<StartChoice>('nextMonday');
  const [customDate, setCustomDate] = useState(toIsoDate(new Date()));
  const { submitting, error, setError, run } = useAsyncSubmit();

  const startDate =
    startChoice === 'custom'
      ? customDate
      : startChoice === 'today'
        ? toIsoDate(new Date())
        : toIsoDate(nextMonday(new Date()));

  const activeByClient = new Map(
    programs.items
      .filter((p) => p.state === 'active' && p.client_id !== null && p.id !== params.id)
      .map((p) => [p.client_id as string, p]),
  );

  const replaceWarnings = selected
    .map((clientId) => {
      const existing = activeByClient.get(clientId);
      if (!existing) return null;
      const client = clients.items.find((c) => c.id === clientId);
      const { currentWeek } = weekCompletion(
        { duration_weeks: existing.duration_weeks, start_date: existing.start_date },
        new Date(),
      );
      const weeksLeft = Math.max(0, existing.duration_weeks - (currentWeek ?? 0));
      return t('builder.assign.replaceWarning', {
        name: client?.displayName ?? '',
        weeks: weeksLeft,
      });
    })
    .filter((message): message is string => message !== null);

  async function handleAssign() {
    setError(null);
    if (selected.length === 0) return;

    await run(async () => {
      try {
        // A small serial loop: assignment is a deliberate, low-frequency
        // action, not a hot path, and one failure should not leave half a
        // batch in flight with no way to tell which half.
        for (const clientId of selected) {
          if (isTemplate) {
            await instantiateTemplate(params.id, clientId, startDate);
          } else {
            await assignProgram(params.id, clientId, startDate);
          }
        }
        router.back();
      } catch {
        setError(t('builder.assign.error'));
      }
    });
  }

  const startOptions: { value: StartChoice; label: string }[] = [
    { value: 'nextMonday', label: t('builder.assign.startNextMonday') },
    { value: 'today', label: t('builder.assign.startToday') },
    { value: 'custom', label: t('builder.assign.startCustom') },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">{t('builder.assign.title')}</Text>
          <Button label={t('common.cancel')} variant="ghost" onPress={() => router.back()} />
        </Row>

        {error ? <Banner variant="danger" message={error} /> : null}

        <Text variant="label" tone="muted">
          {t('builder.assign.clientsLabel')}
        </Text>

        {clients.loading ? (
          <SectionCard>
            <Skeleton height={68} />
            <Skeleton height={68} />
          </SectionCard>
        ) : clients.items.length === 0 ? (
          <Text tone="secondary">{t('builder.assign.empty')}</Text>
        ) : (
          <SectionCard>
            {clients.items.map((client) => {
              const isSelected = selected.includes(client.id);
              return (
                <ListRow
                  key={client.id}
                  minHeight={68}
                  title={client.displayName}
                  subtitle={t('clients.stateLabels.' + client.state)}
                  trailing={
                    <View
                      accessible
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: 2,
                        borderColor: isSelected ? theme.colors.accent : theme.colors.borderStrong,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {isSelected ? (
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            backgroundColor: theme.colors.accent,
                          }}
                        />
                      ) : null}
                    </View>
                  }
                  onPress={() =>
                    setSelected((prev) =>
                      prev.includes(client.id)
                        ? prev.filter((id) => id !== client.id)
                        : [...prev, client.id],
                    )
                  }
                />
              );
            })}
          </SectionCard>
        )}

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" tone="muted">
            {t('builder.assign.startDateLabel')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {startOptions.map((option) => {
              const isSelected = option.value === startChoice;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setStartChoice(option.value)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: theme.radius.pill,
                    borderWidth: 1,
                    borderColor: isSelected ? theme.colors.accent : theme.colors.border,
                    backgroundColor: isSelected
                      ? theme.colors.accentSurfaceSoft
                      : theme.colors.surfaceRaised,
                  }}
                >
                  <Text variant="caption" style={{ fontWeight: '600' }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {startChoice === 'custom' ? (
            <TextField
              label={t('builder.assign.startDateLabel')}
              value={customDate}
              onChangeText={setCustomDate}
              autoCapitalize="none"
              placeholder="2026-09-14"
            />
          ) : (
            <Text numeric variant="caption" tone="muted">
              {startDate}
            </Text>
          )}
        </View>

        {replaceWarnings.map((message) => (
          <Banner key={message} variant="warn" message={message} />
        ))}

        <Button
          label={t('builder.assign.confirm')}
          size="lg"
          disabled={submitting || selected.length === 0}
          onPress={() => void handleAssign()}
        />
      </ScrollView>
    </Screen>
  );
}

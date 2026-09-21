import {
  checkCalendarDate,
  programStartDateBounds,
  toCalendarDate,
  weekCompletion,
} from '@forge/shared';
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
  Avatar,
  Banner,
  Button,
  DateField,
  FooterBar,
  ListRow,
  NavHeader,
  Screen,
  SectionCard,
  SectionLabel,
  Skeleton,
  Tag,
  Text,
} from '../../../../ui';

type StartChoice = 'nextMonday' | 'today' | 'custom';

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
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ id: string; template?: string }>();
  const isTemplate = params.template === '1';

  const clients = useClientList(auth.user?.id, '', 'all');
  const programs = useProgramList('assigned');

  /**
   * 'accepted' belongs here, not just 'active'. claim_client_invites() parks a client
   * in 'accepted' the moment they link their account, and nothing promotes them to
   * 'active' until they submit an intake (0010) — so filtering on 'active' alone made
   * a freshly-onboarded client invisible on the one screen that exists to give them a
   * program. 'invited' is excluded on purpose: there is no account to assign to yet.
   */
  const assignable = [
    // The PT's own record is deliberately absent from `items`, so it has to be
    // put back here: this is the only screen that can give anyone a program,
    // and a PT who cannot program themselves cannot train themselves.
    ...(clients.selfItem !== null ? [{ ...clients.selfItem, displayName: t('me.label') }] : []),
    ...clients.items.filter((c) => c.state === 'active' || c.state === 'accepted'),
  ];

  const [selected, setSelected] = useState<string[]>([]);
  const [startChoice, setStartChoice] = useState<StartChoice>('nextMonday');
  const [customDate, setCustomDate] = useState(toCalendarDate(new Date()));
  const { submitting, error, setError, run } = useAsyncSubmit();

  const dateBounds = programStartDateBounds();

  const startDate =
    startChoice === 'custom'
      ? customDate
      : startChoice === 'today'
        ? toCalendarDate(new Date())
        : toCalendarDate(nextMonday(new Date()));

  /**
   * The inline message under the custom date, or undefined while it is usable.
   *
   * An empty value is a problem HERE even though checkCalendarDate treats it as
   * "not answered" — every other date in the app is optional, and a program's
   * start is not.
   */
  const customDateError =
    startChoice !== 'custom'
      ? undefined
      : customDate.trim() === ''
        ? t('common.dateValidation.malformed')
        : (() => {
            const problem = checkCalendarDate(customDate, dateBounds);
            if (problem === null) return undefined;
            if (problem === 'malformed') return t('common.dateValidation.malformed');
            return problem === 'before_min'
              ? t('common.dateValidation.beforeMin', { min: dateBounds.min })
              : t('common.dateValidation.afterMax', { max: dateBounds.max });
          })();

  const activeByClient = new Map(
    programs.items
      .filter((p) => p.state === 'active' && p.client_id !== null && p.id !== params.id)
      .map((p) => [p.client_id as string, p]),
  );

  const replaceWarnings = selected
    .map((clientId) => {
      const existing = activeByClient.get(clientId);
      if (!existing) return null;
      const client = assignable.find((c) => c.id === clientId);
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
    if (selected.length === 0 || customDateError !== undefined) return;

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
    <Screen padded={false}>
      <NavHeader
        title={t('builder.assign.title')}
        leading={<Button label={t('common.cancel')} variant="link" onPress={() => router.back()} />}
      />
      <ScrollView
        contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Banner variant="danger" message={error} /> : null}

        <SectionLabel>{t('builder.assign.clientsLabel')}</SectionLabel>

        {clients.loading ? (
          <SectionCard>
            <Skeleton height={68} />
            <Skeleton height={68} />
          </SectionCard>
        ) : assignable.length === 0 ? (
          <Text tone="secondary">{t('builder.assign.empty')}</Text>
        ) : (
          <SectionCard>
            {assignable.map((client) => {
              const isSelected = selected.includes(client.id);
              return (
                <ListRow
                  key={client.id}
                  minHeight={68}
                  chevron={false}
                  leading={<Avatar name={client.displayName} photoUrl={client.avatarUrl} size={38} />}
                  title={client.displayName}
                  subtitle={client.isSelf ? t('me.assignSubtitle') : t('clients.stateLabels.' + client.state)}
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
          <SectionLabel>{t('builder.assign.startDateLabel')}</SectionLabel>
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
            /* A DateField, not a TextField with a "YYYY-MM-DD" placeholder.
               The picker cannot emit a malformed or out-of-range day at all,
               which is the whole point: this value goes straight into
               assign_program/instantiate_template's DATE parameter, where
               garbage surfaced as an unexplained PostgREST 22007 behind the
               generic "Couldn't assign" copy, and a well-formed typo did not
               surface at all. */
            <DateField
              label={t('builder.assign.startDateLabel')}
              placeholder={t('common.datePicker.open')}
              value={customDate}
              onChange={setCustomDate}
              minDate={dateBounds.min}
              maxDate={dateBounds.max}
              error={customDateError}
              locale={i18n.language}
              labels={{
                open: t('common.datePicker.open'),
                title: t('common.datePicker.title'),
                clear: t('common.datePicker.clear'),
                done: t('common.datePicker.done'),
                previousMonth: t('common.datePicker.previousMonth'),
                nextMonth: t('common.datePicker.nextMonth'),
                chooseYear: t('common.datePicker.chooseYear'),
              }}
            />
          ) : (
            <Tag numeric label={startDate} />
          )}
        </View>

        {replaceWarnings.map((message, index) => (
          <Banner key={`${index}-${message}`} variant="warn" message={message} />
        ))}
      </ScrollView>

      <FooterBar>
        <Button
          label={t('builder.assign.confirm')}
          size="lg"
          loading={submitting}
          disabled={selected.length === 0 || customDateError !== undefined}
          onPress={() => void handleAssign()}
        />
      </FooterBar>
    </Screen>
  );
}

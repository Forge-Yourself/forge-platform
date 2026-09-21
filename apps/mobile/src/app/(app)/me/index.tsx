import {
  bodyToDisplay,
  bodyUnit,
  formatBody,
  weekCompletion,
} from '@forge/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { useBodySummary } from '../../../lib/body/useBodySummary';
import { SessionList } from '../../../lib/logging/SessionList';
import { StartSessionSheet } from '../../../lib/logging/StartSessionSheet';
import { useSessionHistory } from '../../../lib/logging/useSessionHistory';
import { OfflineStatusChip } from '../../../lib/offline/OfflineStatusChip';
import { useClientActiveProgram } from '../../../lib/programs/useClientActiveProgram';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  Card,
  FooterBar,
  Icon,
  ListRow,
  NavHeader,
  Row,
  Screen,
  SectionCard,
  SectionLabel,
  Skeleton,
  StatTile,
  Tag,
  Text,
  WeekStrip,
} from '../../../ui';

/** "Mar 2026" — matches client detail's "Training since" tile. */
function shortMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', year: 'numeric' });
}

/**
 * Programs is a TAB, and /me is a screen pushed over the tab navigator, so
 * this has to dismiss rather than push: pushing a tabs route from under a
 * pushed screen mounts a second tab navigator (PITFALLS N9).
 */
function goToPrograms(): void {
  router.dismissTo('/(app)/(tabs)/programs');
}

/**
 * The PT's own training record — their client detail screen, for themselves.
 *
 * WHY THIS IS ITS OWN ROUTE rather than a branch inside clients/[id]:
 * that screen gates Start on `hasSubmittedIntake`, and the self record has no
 * intake by design, so reusing it would leave a PT permanently unable to start
 * their own session. Five more of its sections (the intake card, the essentials
 * from intakeSummary, the red-flag card, the Manage pause/deactivate block and
 * two stat labels) are wrong here too. Wrapping all six in `isSelf ?` is the
 * same line count as this file and leaves six places where a later change to
 * client detail silently applies to a record nobody reviewed it against
 * (PITFALLS N13).
 *
 * Two decisions worth keeping:
 *
 *  - `viewerIsPt` is TRUE on the start sheet. The online RPC infers
 *    `is_pt_led` from is_pt_of_client, which is true for a self row, so a self
 *    session is pt-led whatever the app says. The OFFLINE path has no such
 *    inference — it queues whatever this prop says — so passing false here
 *    would make an offline-started session disagree with an online one, and
 *    its finish note would land in session_notes where the summary screen
 *    never looks for it.
 *
 *  - On a wide window a self session still opens the iPad ConsoleShell and
 *    still appears in the floor rail. That is deliberate: a PT training
 *    between clients on the gym iPad is exactly M4d's case, and the rail is
 *    how they get back to it. Do not "fix" it.
 */
export default function MyTraining() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  // The param is the freshly-minted id handed over by the Today screen's CTA:
  // ensure_self_client() returns before AuthProvider's USER_UPDATED round trip
  // has repopulated auth.selfClientId, so for one navigation it is the only
  // copy we have. Both resolve to the same row.
  const params = useLocalSearchParams<{ clientId?: string }>();
  const clientId = auth.selfClientId ?? (params.clientId || undefined);

  const unitSystem = (auth.user?.unit_system as 'metric' | 'imperial') ?? 'metric';
  const program = useClientActiveProgram(clientId);
  const body = useBodySummary(clientId);
  const sessions = useSessionHistory(clientId, 3);
  const [startOpen, setStartOpen] = useState(false);

  // Resume rather than Start when one is still running — starting again would
  // hand back the same row anyway (start_workout_session resumes).
  const inProgress = sessions.items.find((s) => s.status === 'in_progress') ?? null;

  const programWeeks =
    program.program !== null
      ? weekCompletion(
          { duration_weeks: program.program.duration_weeks, start_date: program.program.start_date },
          new Date(),
        )
      : null;

  // dismissTo, not back(): /me is reachable from a cold deep link with nothing
  // beneath it, and back() there pops to nowhere (PITFALLS N15).
  const back = (
    <Button
      label={t('common.back')}
      icon="chevronBack"
      variant="link"
      onPress={() => router.dismissTo('/')}
    />
  );

  // No self record yet. Reached by deep link, or by a PT who has not opted in.
  // The Today screen owns creation, so this points back at it rather than
  // minting a row as a side effect of being looked at.
  if (clientId === undefined) {
    return (
      <Screen padded={false}>
        <NavHeader leading={back} title={t('me.title')} divider />
        <ScrollView contentContainerStyle={{ padding: theme.space[5], gap: theme.space[4] }}>
          <Card>
            <Text tone="secondary">{t('me.cardBody')}</Text>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t('me.title')} divider />

      <ScrollView
        contentContainerStyle={{
          padding: theme.space[5],
          paddingBottom: theme.space[9],
          gap: theme.space[5],
        }}
      >
        <OfflineStatusChip />

        {program.error !== null ? (
          <Banner variant="danger" message={t('clients.offlineError.body')} />
        ) : null}

        <Row style={{ gap: theme.space[2], alignItems: 'stretch' }}>
          <StatTile
            label={t('me.statSince')}
            value={auth.user ? shortMonthYear(auth.user.created_at) : '—'}
          />
          <StatTile
            label={t('me.statWeek')}
            value={
              programWeeks?.currentWeek ? String(programWeeks.currentWeek) : t('clients.detail.stats.none')
            }
          />
          <StatTile
            label={t('me.statWeight')}
            value={
              body.latestKg === null
                ? '—'
                : `${formatBody(bodyToDisplay('weight', body.latestKg, unitSystem), 'weight', unitSystem)}`
            }
          />
        </Row>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('me.programTitle')}</SectionLabel>
          {program.loading ? (
            <Skeleton height={96} radius={14} />
          ) : program.program === null ? (
            <Card style={{ gap: theme.space[3] }}>
              <Text tone="secondary">{t('me.programNone')}</Text>
              {/* The copy promises assigning one, so assigning one is on this
                  screen rather than somewhere the PT has to go find (N14). */}
              <Button
                label={t('me.programAssign')}
                variant="ghost"
                onPress={goToPrograms}
              />
            </Card>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={program.program.name}
              onPress={() =>
                router.push({ pathname: '/(app)/my-program', params: { id: program.program!.id } })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card style={{ gap: theme.space[3] }}>
                <Row style={{ justifyContent: 'space-between', gap: theme.space[2] }}>
                  <Text variant="h3" numberOfLines={1} style={{ flex: 1 }}>
                    {program.program.name}
                  </Text>
                  {programWeeks?.currentWeek ? (
                    <Tag
                      numeric
                      tone="accent"
                      label={t('programs.weekTag', { week: programWeeks.currentWeek })}
                    />
                  ) : null}
                </Row>
                {programWeeks ? (
                  <WeekStrip
                    weeks={programWeeks.weeks}
                    label={t('clientHome.program.weekOf', {
                      week: programWeeks.currentWeek ?? 1,
                      total: program.program.duration_weeks,
                    })}
                  />
                ) : null}
              </Card>
            </Pressable>
          )}
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('me.bodyTitle')}</SectionLabel>
          <SectionCard>
            <ListRow
              leading={<Icon name="sliders" size={19} color={theme.colors.textMuted} />}
              title={
                body.latestKg === null
                  ? t('body.cardEmpty')
                  : `${formatBody(bodyToDisplay('weight', body.latestKg, unitSystem), 'weight', unitSystem)} ${bodyUnit('weight', unitSystem)}`
              }
              subtitle={
                body.delta4wKg === null
                  ? undefined
                  : t('body.cardDelta', {
                      delta: `${body.delta4wKg > 0 ? '+' : ''}${formatBody(bodyToDisplay('weight', body.delta4wKg, unitSystem), 'weight', unitSystem)}`,
                    })
              }
              trailing={body.plateau ? <Tag label={t('body.plateau')} tone="warn" /> : undefined}
              onPress={() => router.push({ pathname: '/(app)/body/[clientId]', params: { clientId } })}
            />
            {/* "My photos", not "Shared photos": on the PT's own record there is
                nobody to share with, and the capture screen says so. */}
            <ListRow
              leading={<Icon name="user" size={19} color={theme.colors.textMuted} />}
              title={t('me.bodyPhotos')}
              trailing={<Tag label={String(body.photoCount)} numeric />}
              onPress={() =>
                router.push({ pathname: '/(app)/body/[clientId]/photos', params: { clientId } })
              }
              isLast
            />
          </SectionCard>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionLabel>{t('me.sessionsTitle')}</SectionLabel>
            {sessions.items.length > 0 ? (
              <Button
                label={t('common.seeAll')}
                variant="link"
                onPress={() => router.push('/(app)/me/sessions')}
              />
            ) : null}
          </Row>
          {sessions.loading ? (
            <Skeleton height={68} radius={14} />
          ) : sessions.items.length > 0 ? (
            <SessionList items={sessions.items} limit={3} />
          ) : (
            <Card>
              <Text tone="secondary">{t('me.sessionsEmpty')}</Text>
            </Card>
          )}
        </View>
      </ScrollView>

      <FooterBar>
        <Button
          label={inProgress ? t('me.resumeSession') : t('me.startSession')}
          size="lg"
          onPress={() => {
            if (inProgress) {
              router.push({ pathname: '/(app)/sessions/[id]', params: { id: inProgress.id } });
            } else {
              setStartOpen(true);
            }
          }}
        />
      </FooterBar>

      <StartSessionSheet
        visible={startOpen}
        clientId={clientId}
        viewerIsPt
        onNoProgram={goToPrograms}
        onDismiss={() => setStartOpen(false)}
      />
    </Screen>
  );
}

import { weekCompletion, type Database } from '@forge/shared';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useCreditBalance } from '../../../lib/ai/useCreditBalance';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { usePtDashboard, type AttentionItem } from '../../../lib/home/usePtDashboard';
import { claimClientInvites } from '../../../lib/intake/claimInvites';
import { openWaiverDocument } from '../../../lib/intake/openWaiver';
import { SessionList } from '../../../lib/logging/SessionList';
import { StartSessionSheet } from '../../../lib/logging/StartSessionSheet';
import { useInProgressSession } from '../../../lib/logging/useInProgressSession';
import { useSessionHistory } from '../../../lib/logging/useSessionHistory';
import { useProgramList } from '../../../lib/programs/useProgramList';
import { supabase } from '../../../lib/supabase';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Icon,
  IconButton,
  ListRow,
  Row,
  Screen,
  SectionCard,
  SectionLabel,
  Skeleton,
  Spinner,
  StatTile,
  Tag,
  Text,
  WeekStrip,
  type IconName,
} from '../../../ui';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type IntakeFormRow = Database['public']['Tables']['intake_forms']['Row'];
type PtInfo = { display_name: string; avatar_url: string | null };

/**
 * The ONLY way into (app)/settings, and therefore the only way to sign out, change
 * language or units, enrol/unenrol MFA, edit a profile, or withdraw a consent — every
 * one of those lives behind that route and nothing else links to it.
 *
 * It sits on Today rather than in the tab bar because a client has no tab bar at all
 * ((tabs)/_layout.tsx renders none for them), so a fifth tab would leave the client
 * personas exactly as stranded as before. Today is the one screen both personas land
 * on, which makes it the one place this row is reachable from for everyone.
 */
function SettingsButton() {
  const { t } = useTranslation();
  return (
    <IconButton
      icon="sliders"
      variant="ghost"
      accessibilityLabel={t('settings.title')}
      onPress={() => router.push('/(app)/settings')}
    />
  );
}

/** "09:14" — the wall-clock start of a running session, for the Resume banner. */
function sessionStartTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "Good morning / afternoon / evening" — the device clock, no locale calendar needed. */
function greetingKey(hour: number): string {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/**
 * The greeting block both personas share: a muted time-of-day line, the person's
 * own name at screen-title size, and the settings control.
 */
function HomeHeader({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.space[3] }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" tone="muted">
          {t(greetingKey(new Date().getHours()))}
        </Text>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ fontSize: 27, fontWeight: '800', letterSpacing: -0.5 }}
        >
          {name}
        </Text>
      </View>
      <SettingsButton />
    </Row>
  );
}

/** One square of the quick-actions grid: icon disc, label, whole tile is the target. */
function ActionTile({
  icon,
  label,
  accent,
  onPress,
}: {
  icon: IconName;
  label: string;
  accent?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '47%',
        minHeight: 96,
        justifyContent: 'space-between',
        padding: theme.space[4],
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: accent ? theme.colors.accent : theme.colors.border,
        backgroundColor: accent ? theme.colors.accentSurfaceSoft : theme.colors.surfaceRaised,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon
        name={icon}
        size={22}
        color={accent ? theme.colors.onAccentSurfaceSoft : theme.colors.textSecondary}
      />
      <Text
        numberOfLines={2}
        style={{
          fontSize: 14,
          fontWeight: '700',
          color: accent ? theme.colors.onAccentSurfaceSoft : theme.colors.textPrimary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const ATTENTION_TAG_TONE = {
  flags: 'danger',
  waiver: 'warn',
  invited: 'neutral',
  noProgram: 'accent',
} as const;

function AttentionRow({ item, isLast }: { item: AttentionItem; isLast: boolean }) {
  const { t } = useTranslation();

  const subtitle =
    item.reason === 'flags'
      ? t('home.attention.redFlags', { count: item.count ?? 0 })
      : t('home.attention.' + item.reason);

  const tagKey =
    item.reason === 'flags'
      ? 'tagFlags'
      : item.reason === 'waiver'
        ? 'tagWaiver'
        : item.reason === 'invited'
          ? 'tagInvited'
          : 'tagProgram';

  return (
    <ListRow
      minHeight={68}
      leading={<Avatar name={item.name} photoUrl={item.avatarUrl} size={38} />}
      title={item.name}
      subtitle={subtitle}
      trailing={<Tag label={t('home.attention.' + tagKey)} tone={ATTENTION_TAG_TONE[item.reason]} />}
      isLast={isLast}
      onPress={() => router.push({ pathname: '/(app)/clients/[id]', params: { id: item.clientId } })}
    />
  );
}

/**
 * The PT's home. Three bands: where the roster stands, who is blocking, and the
 * four things a PT starts a day by doing.
 *
 * What this replaced was M0 scaffolding that never got swapped out — a "Foundation
 * online" card reporting the colour scheme, the layout direction and a Supabase
 * reachability probe, followed by a typography specimen ("Aa", one line per type
 * style). Useful on the day the monorepo booted; the PT's home screen for three
 * milestones after that.
 *
 * There is no session list and no adherence figure here, because logging is M4 and
 * scheduling is M5. Every number below is read from a table that exists today.
 */
function PtHome() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const dashboard = usePtDashboard(auth.user?.id);
  const credits = useCreditBalance(auth.user?.id);
  const live = useInProgressSession();

  // Bound once so the press handler closes over a non-null row rather than a
  // `!` assertion on something the render already narrowed.
  const liveSession = live.session;
  const rosterPreview = dashboard.activeClients.slice(0, 4);
  const remaining = dashboard.activeClients.length - rosterPreview.length;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.space[5],
          paddingBottom: theme.space[9],
          gap: theme.space[5],
        }}
      >
        <HomeHeader name={auth.user?.display_name ?? ''} />

        {/* Spec §5.1 — one banner, naming the client, for the most recently
            started session the PT can still see. It sits above everything else
            on Today because it is the only card that is time-critical. */}
        {liveSession ? (
          <Card
            style={{
              gap: theme.space[2],
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.accentSurfaceSoft,
            }}
          >
            <Text variant="h3" style={{ color: theme.colors.onAccentSurfaceSoft }}>
              {t('home.resume.title')}
            </Text>
            <Text style={{ color: theme.colors.onAccentSurfaceSoft }}>
              {liveSession.clientName
                ? t('home.resume.body', {
                    name: liveSession.clientName,
                    time: sessionStartTime(liveSession.started_at ?? liveSession.created_at),
                  })
                : t('home.resume.bodyNoName', {
                    time: sessionStartTime(liveSession.started_at ?? liveSession.created_at),
                  })}
            </Text>
            <Button
              label={t('home.resume.button')}
              size="lg"
              onPress={() =>
                router.push({ pathname: '/(app)/sessions/[id]', params: { id: liveSession.id } })
              }
            />
          </Card>
        ) : null}

        {dashboard.error ? <Banner variant="danger" message={t('home.error')} /> : null}

        {dashboard.loading ? (
          <Skeleton height={66} radius={theme.radius.lg - 2} />
        ) : (
          <Row style={{ gap: theme.space[2], alignItems: 'stretch' }}>
            <StatTile label={t('home.stats.clients')} value={String(dashboard.activeClients.length)} />
            <StatTile label={t('home.stats.programs')} value={String(dashboard.runningProgramCount)} />
            <StatTile
              label={t('home.stats.credits')}
              value={credits.state === 'loading' ? '—' : String(credits.balance ?? 0)}
              tone="accent"
            />
          </Row>
        )}

        {!dashboard.loading && dashboard.activeClients.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <SectionLabel>{t('home.attention.heading')}</SectionLabel>
            {dashboard.attention.length === 0 ? (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: theme.colors.successSurface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="check" size={19} color={theme.colors.onSuccessSurface} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyBold">{t('home.attention.allClearTitle')}</Text>
                  <Text variant="caption" tone="muted">
                    {t('home.attention.allClearBody')}
                  </Text>
                </View>
              </Card>
            ) : (
              <SectionCard>
                {dashboard.attention.map((item, index) => (
                  <AttentionRow
                    key={item.clientId}
                    item={item}
                    isLast={index === dashboard.attention.length - 1}
                  />
                ))}
              </SectionCard>
            )}
          </View>
        ) : null}

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('home.actions.heading')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <ActionTile
              icon="users"
              label={t('home.actions.invite')}
              onPress={() => router.push('/(app)/clients/invite')}
            />
            <ActionTile
              icon="calendar"
              label={t('home.actions.newProgram')}
              onPress={() => router.push('/(app)/(tabs)/programs')}
            />
            <ActionTile
              icon="sparkle"
              label={t('home.actions.aiDraft')}
              accent
              onPress={() => router.push('/(app)/programs/ai')}
            />
            <ActionTile
              icon="dumbbell"
              label={t('home.actions.library')}
              onPress={() => router.push('/(app)/(tabs)/library')}
            />
          </View>
        </View>

        {rosterPreview.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <SectionLabel>{t('home.roster.heading')}</SectionLabel>
              <Button
                label={t('home.roster.seeAll')}
                variant="link"
                onPress={() => router.push('/(app)/(tabs)/clients')}
              />
            </Row>
            <SectionCard>
              {rosterPreview.map((client, index) => (
                <ListRow
                  key={client.id}
                  minHeight={64}
                  leading={<Avatar name={client.displayName} photoUrl={client.avatarUrl} size={36} />}
                  title={client.displayName}
                  subtitle={t('clients.stateLabels.' + client.state)}
                  isLast={index === rosterPreview.length - 1 && remaining <= 0}
                  onPress={() =>
                    router.push({ pathname: '/(app)/clients/[id]', params: { id: client.id } })
                  }
                />
              ))}
              {remaining > 0 ? (
                <ListRow
                  title={t('home.roster.more', { count: remaining })}
                  isLast
                  onPress={() => router.push('/(app)/(tabs)/clients')}
                />
              ) : null}
            </SectionCard>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

type ClientHomeState = {
  loading: boolean;
  client: ClientRow | null;
  ptInfo: PtInfo | null;
  intake: IntakeFormRow | null;
};

/**
 * Signed-in client home — their trainer, the one thing they owe next (intake,
 * waiver, or nothing), their assigned program, and the signed waiver as a
 * downloadable row once it exists. No logging or metrics — those are M4.
 *
 * The three intake states used to render as three sibling cards that each looked
 * equally urgent next to the program card. They are mutually exclusive by
 * definition, so they now collapse into one ember "next step" card — the client
 * sees exactly one thing they owe, or none.
 */
function ClientHome() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [state, setState] = useState<ClientHomeState>({
    loading: true,
    client: null,
    ptInfo: null,
    intake: null,
  });
  const [emailCopied, setEmailCopied] = useState(false);
  const [waiverError, setWaiverError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const live = useInProgressSession();
  const liveSession = live.session;
  // No client id: RLS already scopes this to the signed-in client's own rows.
  const recent = useSessionHistory(undefined, 3);

  // RLS already returns only 'active'/'completed' programs to a client
  // (is_program_visible), so there is no state filter here and there must not
  // be one: the absence of it is what proves a draft is invisible by policy
  // rather than by a client-side check somebody could later remove.
  const programs = useProgramList('assigned');
  const myProgram = programs.items[0] ?? null;

  // Inlined with .then() (not a separately-defined callback) so every setState
  // call stays visible to the linter inside this effect body — same
  // react-hooks/set-state-in-effect constraint documented in
  // usePtProfileData.ts and lib/clients/useClientList.ts.
  useEffect(() => {
    let cancelled = false;
    void claimClientInvites()
      .catch(() => {
        // Best-effort — a failed claim just means the client sees the
        // no-trainer-yet state below, which already has its own recovery copy.
      })
      .then(async () => {
        const { data: client } = await supabase
          .from('clients')
          .select('*')
          .eq('client_user_id', auth.user?.id ?? '')
          .maybeSingle();

        if (!client) {
          if (!cancelled) setState({ loading: false, client: null, ptInfo: null, intake: null });
          return;
        }

        const [{ data: ptInfo }, { data: intake }] = await Promise.all([
          supabase.from('users').select('display_name, avatar_url').eq('id', client.pt_user_id).maybeSingle(),
          supabase.from('intake_forms').select('*').eq('client_id', client.id).maybeSingle(),
        ]);

        if (!cancelled) {
          setState({ loading: false, client, ptInfo: ptInfo ?? null, intake: intake ?? null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  async function handleCopyEmail() {
    if (!auth.user?.email) return;
    await Clipboard.setStringAsync(auth.user.email);
    setEmailCopied(true);
  }

  async function handleOpenWaiver() {
    if (!state.intake) return;
    setWaiverError(null);
    try {
      await openWaiverDocument(state.intake.id);
    } catch {
      setWaiverError(t('waiver.submitError'));
    }
  }

  if (state.loading) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  if (!state.client) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={{ padding: theme.space[5], gap: theme.space[4] }}>
          <HomeHeader name={auth.user?.display_name ?? ''} />
          <Card style={{ gap: theme.space[3] }}>
            <Text variant="h3">{t('clientHome.noTrainerTitle')}</Text>
            <Text tone="secondary">{t('clientHome.noTrainerBody')}</Text>
            <View
              style={{
                padding: theme.space[3],
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surfaceSunken,
              }}
            >
              <Text numeric style={{ fontSize: 13 }}>
                {auth.user?.email}
              </Text>
            </View>
            <Button
              label={emailCopied ? t('clientHome.emailCopied') : t('clientHome.copyEmail')}
              icon={emailCopied ? 'check' : 'copy'}
              variant="ghost"
              onPress={() => void handleCopyEmail()}
            />
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  const intakeState = state.intake?.state ?? 'pending';
  const waiverSigned = intakeState === 'waiver_signed';
  const needsWaiver = intakeState === 'completed' || intakeState === 'red_flag_review';
  const intakeId = state.intake?.id;

  const nextStep =
    intakeState === 'pending'
      ? {
          title: t('clientHome.intake.notStarted'),
          body: t('clientHome.intake.notStartedBody'),
          action: t('clientHome.intake.startButton'),
          go: () =>
            intakeId && router.push({ pathname: '/(app)/intake/[id]', params: { id: intakeId } }),
        }
      : intakeState === 'in_progress'
        ? {
            title: t('clientHome.intake.inProgress'),
            body: null,
            action: t('clientHome.intake.resumeButton'),
            go: () =>
              intakeId && router.push({ pathname: '/(app)/intake/[id]', params: { id: intakeId } }),
          }
        : needsWaiver
          ? {
              title: t('clientHome.intake.signWaiver'),
              body: null,
              action: t('clientHome.intake.signWaiverButton'),
              go: () =>
                intakeId &&
                router.push({ pathname: '/(app)/intake/[id]/waiver', params: { id: intakeId } }),
            }
          : null;

  const programWeeks = myProgram
    ? weekCompletion(
        { duration_weeks: myProgram.duration_weeks, start_date: myProgram.start_date },
        new Date(),
      )
    : null;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.space[5],
          paddingBottom: theme.space[9],
          gap: theme.space[5],
        }}
      >
        <HomeHeader name={auth.user?.display_name ?? ''} />

        {waiverError ? <Banner variant="danger" message={waiverError} /> : null}

        {nextStep ? (
          <Card
            style={{
              gap: theme.space[3],
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.accentSurfaceSoft,
            }}
          >
            <Text variant="h3" style={{ color: theme.colors.onAccentSurfaceSoft }}>
              {nextStep.title}
            </Text>
            {nextStep.body ? (
              <Text style={{ fontSize: 13.5, lineHeight: 20, color: theme.colors.onAccentSurfaceSoft }}>
                {nextStep.body}
              </Text>
            ) : null}
            <Button label={nextStep.action} size="lg" onPress={nextStep.go} />
          </Card>
        ) : null}

        {/* Resume wins over Start. The start card is gated on a signed waiver so
            a client cannot train before the paperwork their PT is already being
            nudged about on their own Today screen. */}
        {liveSession ? (
          <Card style={{ gap: theme.space[3], borderColor: theme.colors.accent }}>
            <Text variant="h3">{t('clientHome.workout.resumeTitle')}</Text>
            <Button
              label={t('clientHome.workout.resumeButton')}
              size="lg"
              onPress={() =>
                router.push({ pathname: '/(app)/sessions/[id]', params: { id: liveSession.id } })
              }
            />
          </Card>
        ) : waiverSigned ? (
          <Card style={{ gap: theme.space[3] }}>
            <Text variant="h3">{t('clientHome.workout.startTitle')}</Text>
            <Text tone="secondary">{t('clientHome.workout.startBody')}</Text>
            <Button
              label={
                myProgram ? t('clientHome.workout.startButton') : t('clientHome.workout.startFreestyle')
              }
              size="lg"
              onPress={() => setStartOpen(true)}
            />
          </Card>
        ) : null}

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('clientHome.trainerLabel')}</SectionLabel>
          <SectionCard>
            <ListRow
              leading={
                <Avatar name={state.ptInfo?.display_name} photoUrl={state.ptInfo?.avatar_url} size={38} />
              }
              title={state.ptInfo?.display_name ?? '—'}
              chevron={false}
              isLast
            />
          </SectionCard>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('clientHome.program.cardLabel')}</SectionLabel>
          {myProgram === null ? (
            <Card>
              <Text tone="secondary">{t('clientHome.program.none')}</Text>
            </Card>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={myProgram.name}
              onPress={() => router.push({ pathname: '/(app)/my-program', params: { id: myProgram.id } })}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Card style={{ gap: theme.space[3] }}>
                <Row style={{ justifyContent: 'space-between', gap: theme.space[2] }}>
                  <Text variant="h3" numberOfLines={1} style={{ flex: 1 }}>
                    {myProgram.name}
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
                      total: myProgram.duration_weeks,
                    })}
                  />
                ) : null}
                <Text numeric variant="caption" tone="muted">
                  {t('programs.meta', {
                    weeks: myProgram.duration_weeks,
                    days: myProgram.days_per_week,
                    exercises: myProgram.exercise_count,
                  })}
                </Text>
              </Card>
            </Pressable>
          )}
        </View>

        {waiverSigned && state.intake ? (
          <View style={{ gap: theme.space[2] }}>
            <SectionLabel>{t('clients.detail.waiverHeading')}</SectionLabel>
            <SectionCard>
              <ListRow
                leading={<Icon name="document" size={20} color={theme.colors.textMuted} />}
                title={t('clientHome.waiver.rowTitle')}
                subtitle={
                  state.intake.signed_at
                    ? t('clientHome.waiver.rowSubtitle', {
                        date: new Date(state.intake.signed_at).toLocaleDateString(),
                      })
                    : undefined
                }
                onPress={() => void handleOpenWaiver()}
              />
            </SectionCard>
          </View>
        ) : null}

        <View style={{ gap: theme.space[2] }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionLabel>{t('clientHome.workout.recentHeading')}</SectionLabel>
            {recent.items.length > 0 ? (
              <Button
                label={t('common.seeAll')}
                variant="link"
                onPress={() => router.push('/(app)/my-sessions')}
              />
            ) : null}
          </Row>
          {recent.items.length > 0 ? (
            <SessionList items={recent.items} limit={3} />
          ) : recent.loading ? (
            <Skeleton height={64} radius={14} />
          ) : (
            <Card>
              <Text tone="secondary">{t('clientHome.workout.recentEmpty')}</Text>
            </Card>
          )}
        </View>
      </ScrollView>

      <StartSessionSheet
        visible={startOpen}
        clientId={state.client.id}
        viewerIsPt={false}
        onDismiss={() => setStartOpen(false)}
      />
    </Screen>
  );
}

export default function Home() {
  const auth = useAuth();
  return auth.user?.role === 'client' ? <ClientHome /> : <PtHome />;
}

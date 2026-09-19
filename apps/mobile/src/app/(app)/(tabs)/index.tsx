import { weekCompletion, type Database } from '@forge/shared';
import type { TFunction } from 'i18next';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { fetchClientHome } from '../../../lib/home/fetchClientHome';
import { usePtDashboard, type AttentionItem } from '../../../lib/home/usePtDashboard';
import { claimClientInvites } from '../../../lib/intake/claimInvites';
import { openWaiverDocument } from '../../../lib/intake/openWaiver';
import { SessionList } from '../../../lib/logging/SessionList';
import { StartSessionSheet } from '../../../lib/logging/StartSessionSheet';
import { useInProgressSession } from '../../../lib/logging/useInProgressSession';
import { useSessionHistory } from '../../../lib/logging/useSessionHistory';
import { cachedFetch } from '../../../lib/offline/cachedFetch';
import { OfflineStatusChip } from '../../../lib/offline/OfflineStatusChip';
import { useOffline } from '../../../lib/offline/offlineContext';
import { useProgramList } from '../../../lib/programs/useProgramList';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Icon,
  initialsFor,
  ListRow,
  Row,
  Screen,
  SectionCard,
  SectionLabel,
  Skeleton,
  Spinner,
  Tag,
  Text,
  WeekStrip,
} from '../../../ui';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type IntakeFormRow = Database['public']['Tables']['intake_forms']['Row'];
type PtInfo = { display_name: string; avatar_url: string | null };

/** "09:14" — the wall-clock start of a running session. */
function sessionStartTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "Morning / Afternoon / Evening" — the device clock, no locale calendar needed. */
function greetingKey(hour: number): string {
  if (hour < 12) return 'home.greetMorning';
  if (hour < 18) return 'home.greetAfternoon';
  return 'home.greetEvening';
}

/** Prototype `home`: the 11/700 uppercase kicker used for the date and every section rule. */
function Kicker({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: theme.colors.textMuted,
      }}
    >
      {children}
    </Text>
  );
}

/** Rounded-square initials tile — the prototype's avatar shape on Today (42/r14, 46/r14). */
function InitialsTile({ name, size, accent }: { name: string | null; size: number; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        backgroundColor: accent ? theme.colors.accentSurfaceSoft : theme.colors.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Text
        style={{
          fontSize: Math.round(size * 0.35),
          fontWeight: '800',
          color: accent ? theme.colors.onAccentSurfaceSoft : theme.colors.textSecondary,
        }}
      >
        {initialsFor(name)}
      </Text>
    </View>
  );
}

/**
 * Prototype `home` header: the date as a kicker, "Morning, Rami" at 25/800, and
 * the person's initials tile on the trailing edge.
 *
 * The tile is also the ONLY way into (app)/settings, and therefore the only way
 * to sign out, change language or units, enrol/unenrol MFA, edit a profile, or
 * withdraw a consent. It sits on Today rather than in the tab bar because a
 * client has no tab bar at all ((tabs)/_layout.tsx renders none for them), and
 * Today is the one screen both personas land on. The artboard draws the tile
 * without saying what it does; making it the settings control is ours.
 */
function HomeHeader({ name }: { name: string }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const now = new Date();
  const weekday = now.toLocaleDateString(i18n.language, { weekday: 'long' });
  const date = now.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const key = greetingKey(now.getHours());

  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center', gap: theme.space[3] }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Kicker>{`${weekday} · ${date}`}</Kicker>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ fontSize: 25, fontWeight: '800', letterSpacing: -0.4 }}
        >
          {firstName ? t(key + 'Name', { name: firstName }) : t(key)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.title')}
        onPress={() => router.push('/(app)/settings')}
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <InitialsTile name={name} size={42} accent />
      </Pressable>
    </Row>
  );
}

/** One of the three counts: mono 24/700 figure over a 10.5/600 label. */
function CountTile({ value, label, color }: { value: string; label: string; color?: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Text
        numeric
        style={{ fontSize: 24, fontWeight: '700', lineHeight: 26, color: color ?? theme.colors.textPrimary }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 10.5, lineHeight: 14, fontWeight: '600', color: theme.colors.textMuted, marginTop: 6 }}>
        {label}
      </Text>
    </View>
  );
}

/** Prototype `home` "Needs you" row: status dot, two lines, chevron; the whole row is the target. */
function NeedsRow({
  title,
  subtitle,
  dot,
  onPress,
}: {
  title: string;
  subtitle: string;
  dot: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        minHeight: 58,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceRaised,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700' }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: theme.colors.textSecondary, marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      {onPress ? <Icon name="chevron" size={16} color={theme.colors.textMuted} /> : null}
    </Pressable>
  );
}

function attentionSubtitle(item: AttentionItem, t: TFunction): string {
  return item.reason === 'flags'
    ? t('home.attention.redFlags', { count: item.count ?? 0 })
    : t('home.attention.' + item.reason);
}

type NextUp =
  | { kind: 'live'; session: NonNullable<ReturnType<typeof useInProgressSession>['session']> }
  | { kind: 'suggested'; clientId: string; name: string; programName: string; week: number | null };

/**
 * The PT's home — prototype `home`. Three counts, one Next up card, then the
 * things blocking work. The PT needs one decision on open, not a dashboard.
 *
 * Where the artboard assumes M5 bookings it is adapted, not faked:
 * - "Sessions today" counts sessions actually started today; "Due to log" is
 *   the sessions still open.
 * - Next up is the running session if there is one; otherwise the programmed
 *   client who trained least recently, which is who a PT without a calendar
 *   would see next. The trailing mono figure is their program week, not a
 *   booking time, and there is no "Later today" list until bookings exist.
 */
function PtHome() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const dashboard = usePtDashboard(auth.user?.id);
  const offline = useOffline();
  const unsynced = offline.status.pending + offline.status.failed;
  const live = useInProgressSession();
  const history = useSessionHistory(undefined, 50);
  const [startFor, setStartFor] = useState<string | null>(null);

  const today = new Date().toDateString();
  const todays = history.items.filter(
    (s) => s.started_at !== null && new Date(s.started_at).toDateString() === today,
  );
  const openCount = history.items.filter((s) => s.status === 'in_progress').length;

  let nextUp: NextUp | null = live.session ? { kind: 'live', session: live.session } : null;
  if (!nextUp && !history.loading) {
    const lastTrained = new Map<string, number>();
    for (const s of history.items) {
      const at = new Date(s.started_at ?? s.created_at).getTime();
      lastTrained.set(s.client_id, Math.max(lastTrained.get(s.client_id) ?? 0, at));
    }
    const candidates = dashboard.runningPrograms
      .map((p) => ({ p, client: dashboard.activeClients.find((c) => c.id === p.client_id) }))
      .filter((x) => x.client && x.client.state === 'active')
      .sort((a, b) => (lastTrained.get(a.p.client_id ?? '') ?? 0) - (lastTrained.get(b.p.client_id ?? '') ?? 0));
    const pick = candidates[0];
    if (pick?.client) {
      nextUp = {
        kind: 'suggested',
        clientId: pick.client.id,
        name: pick.client.displayName,
        programName: pick.p.name,
        week: weekCompletion(
          { duration_weeks: pick.p.duration_weeks, start_date: pick.p.start_date },
          new Date(),
        ).currentWeek,
      };
    }
  }

  const dotFor: Record<AttentionItem['reason'], string> = {
    flags: theme.colors.dangerAccent,
    waiver: theme.colors.warnAccent,
    invited: theme.colors.textMuted,
    noProgram: theme.colors.accent,
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: theme.space[2],
          paddingHorizontal: theme.space[5],
          paddingBottom: theme.space[9],
        }}
      >
        <OfflineStatusChip style={{ marginBottom: 12 }} />
        <View style={{ marginBottom: 18 }}>
          <HomeHeader name={auth.user?.display_name ?? ''} />
        </View>

        {dashboard.error ? (
          <View style={{ marginBottom: theme.space[4] }}>
            <Banner variant="danger" message={t('home.error')} />
          </View>
        ) : null}

        {!auth.user?.id || dashboard.loading || history.loading ? (
          <View style={{ gap: theme.space[3] }}>
            <Skeleton height={72} radius={12} />
            <Skeleton height={148} radius={14} />
          </View>
        ) : (
          <>
            <Row style={{ gap: 8, alignItems: 'stretch', marginBottom: 20 }}>
              <CountTile value={String(todays.length)} label={t('home.counts.today')} />
              <CountTile value={String(openCount)} label={t('home.counts.dueToLog')} color={theme.colors.accent} />
              <CountTile
                value={String(dashboard.awaitingIntakeCount)}
                label={t('home.counts.awaitingIntake')}
                color={theme.colors.warnAccent}
              />
            </Row>

            {nextUp ? (
              <View style={{ marginBottom: 22 }}>
                <View style={{ marginBottom: 9 }}>
                  <Kicker>{t('home.nextUp.heading')}</Kicker>
                </View>
                <View
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: theme.colors.accent,
                    backgroundColor: theme.colors.surfaceRaised,
                  }}
                >
                  <Row style={{ gap: 12 }}>
                    <InitialsTile
                      name={nextUp.kind === 'live' ? nextUp.session.clientName : nextUp.name}
                      size={46}
                      accent
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700' }}>
                        {(nextUp.kind === 'live' ? nextUp.session.clientName : nextUp.name) ?? '—'}
                      </Text>
                      <Text numberOfLines={1} style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 }}>
                        {nextUp.kind === 'live'
                          ? nextUp.session.week_number === null
                            ? t('logging.history.freestyle')
                            : nextUp.session.day_label
                              ? t('logging.history.dayLabelNamed', {
                                  label: nextUp.session.day_label,
                                  week: nextUp.session.week_number,
                                })
                              : t('logging.history.dayLabel', {
                                  week: nextUp.session.week_number,
                                  day: nextUp.session.day_number ?? 1,
                                })
                          : nextUp.week
                            ? t('home.nextUp.programWeek', { program: nextUp.programName, week: nextUp.week })
                            : nextUp.programName}
                      </Text>
                    </View>
                    <Text numeric style={{ fontSize: 14, fontWeight: '700', color: theme.colors.accentText }}>
                      {nextUp.kind === 'live'
                        ? sessionStartTime(nextUp.session.started_at ?? nextUp.session.created_at)
                        : nextUp.week
                          ? t('home.nextUp.weekShort', { week: nextUp.week })
                          : ''}
                    </Text>
                  </Row>
                  <View style={{ marginTop: 14 }}>
                    {nextUp.kind === 'live' ? (
                      <Button
                        label={t('home.nextUp.resume')}
                        size="lg"
                        onPress={() =>
                          router.push({
                            pathname: '/(app)/sessions/[id]',
                            params: { id: (nextUp as Extract<NextUp, { kind: 'live' }>).session.id },
                          })
                        }
                      />
                    ) : (
                      <Button
                        label={t('home.nextUp.start')}
                        size="lg"
                        onPress={() => setStartFor((nextUp as Extract<NextUp, { kind: 'suggested' }>).clientId)}
                      />
                    )}
                  </View>
                </View>
              </View>
            ) : null}

            <View style={{ marginBottom: 9 }}>
              <Kicker>{t('home.needsYou.heading')}</Kicker>
            </View>
            <View style={{ gap: 8 }}>
              {/* Prototype `home`: Needs you collects an unsynced session alongside intake blockers. */}
              {unsynced > 0 ? (
                <NeedsRow
                  title={t('logging.offline.needsSyncTitle')}
                  subtitle={t('logging.offline.needsSyncBody', { count: unsynced })}
                  dot={offline.status.failed > 0 ? theme.colors.dangerAccent : theme.colors.accent}
                  onPress={() => router.push('/(app)/sync-queue')}
                />
              ) : null}
              {dashboard.activeClients.length === 0 ? (
                <NeedsRow
                  title={t('home.needsYou.emptyTitle')}
                  subtitle={t('home.needsYou.emptyBody')}
                  dot={theme.colors.accent}
                  onPress={() => router.push('/(app)/clients/invite')}
                />
              ) : dashboard.attention.length === 0 ? (
                <NeedsRow
                  title={t('home.attention.allClearTitle')}
                  subtitle={t('home.attention.allClearBody')}
                  dot={theme.colors.successAccent}
                />
              ) : (
                dashboard.attention.map((item) => (
                  <NeedsRow
                    key={item.clientId}
                    title={item.name}
                    subtitle={attentionSubtitle(item, t)}
                    dot={dotFor[item.reason]}
                    onPress={() =>
                      router.push({ pathname: '/(app)/clients/[id]', params: { id: item.clientId } })
                    }
                  />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      {startFor ? (
        <StartSessionSheet
          visible
          clientId={startFor}
          viewerIsPt
          onDismiss={() => setStartFor(null)}
        />
      ) : null}
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
  const offline = useOffline();
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
      .then(() =>
        cachedFetch({ enabled: offline.effective, online: offline.online }, 'clientHome:' + (auth.user?.id ?? ''), () =>
          fetchClientHome(auth.user?.id ?? ''),
        ),
      )
      .then((r) => {
        if (!cancelled) setState({ loading: false, client: r.client, ptInfo: r.ptInfo, intake: r.intake });
      });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id, offline.effective, offline.online]);

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

  // Captured once: a narrowed `state.client` does not survive into the onPress closures below.
  const clientRowId = state.client.id;

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
        <OfflineStatusChip />
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
          <SectionLabel>{t('body.cardTitle')}</SectionLabel>
          <SectionCard>
            <ListRow
              leading={<Icon name="sliders" size={20} color={theme.colors.textMuted} />}
              title={t('body.title')}
              onPress={() => router.push({ pathname: '/(app)/body/[clientId]', params: { clientId: clientRowId } })}
            />
            <ListRow
              leading={<Icon name="user" size={20} color={theme.colors.textMuted} />}
              title={t('body.photos.title')}
              onPress={() => router.push({ pathname: '/(app)/body/[clientId]/photos', params: { clientId: clientRowId } })}
              isLast
            />
          </SectionCard>
        </View>

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

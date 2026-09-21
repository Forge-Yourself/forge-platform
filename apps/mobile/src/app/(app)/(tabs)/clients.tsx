import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { type ClientListFilter, type ClientListItem, useClientList } from '../../../lib/clients/useClientList';
import { OfflineStatusChip } from '../../../lib/offline/OfflineStatusChip';
import { useTheme } from '../../../theme/ThemeProvider';
import {
  Avatar,
  EmptyState,
  IconButton,
  ListRow,
  Screen,
  ScreenHeader,
  SearchField,
  SectionCard,
  SegmentedPill,
  Skeleton,
  Tag,
  Text,
  type TagTone,
} from '../../../ui';

const FILTERS: { value: ClientListFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'clients.filters.all' },
  { value: 'active', labelKey: 'clients.filters.active' },
  { value: 'paused', labelKey: 'clients.filters.paused' },
  { value: 'invited', labelKey: 'clients.filters.invited' },
];

/**
 * Roster state as a chip, not a dot.
 *
 * The trailing affordance used to be an 8pt coloured dot, which carried the state
 * in hue alone — invisible to anyone who cannot separate the ember from the grey,
 * and unreadable to a screen reader. The state name was duplicated in the subtitle
 * to compensate, which spent the subtitle line on something the chip already says.
 */
const STATE_TONE: Record<string, TagTone> = {
  active: 'success',
  accepted: 'success',
  invited: 'warn',
  paused: 'neutral',
  deactivated: 'danger',
};

/**
 * Loading rows mirror the real row's geometry — 68pt tall, a 42pt avatar disc and
 * two text bars at the name/subtitle widths — so the list does not jump when the
 * roster lands. Three bare 68pt blocks (what this was) shimmer in the right place
 * but resolve into something shaped nothing like them.
 */
function SkeletonRow({ isLast }: { isLast?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={t('common.loading')}
      style={{
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[4],
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Skeleton width={42} height={42} radius={21} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="55%" height={13} radius={4} />
        <Skeleton width="35%" height={11} radius={4} />
      </View>
    </View>
  );
}

function ClientRow({ item, isLast }: { item: ClientListItem; isLast: boolean }) {
  const { t } = useTranslation();

  return (
    <ListRow
      minHeight={68}
      leading={<Avatar name={item.displayName} photoUrl={item.avatarUrl} size={42} />}
      title={item.displayName}
      subtitle={item.invite_email ?? undefined}
      trailing={
        <Tag
          label={t('clients.stateLabels.' + item.state).toUpperCase()}
          tone={STATE_TONE[item.state] ?? 'neutral'}
        />
      }
      isLast={isLast}
      onPress={() => router.push({ pathname: '/(app)/clients/[id]', params: { id: item.id } })}
    />
  );
}

/**
 * PT client list — the prototype's `clients` screen drawn as exactly five
 * states behind one set of filter chips: loading, empty, no-match, offline
 * error, and populated. All five render from this one screen/hook pair
 * rather than five separate mockup routes.
 *
 * The title, search box and filter pill sit outside the ScrollView so they stay
 * put while the roster moves under them — previously all three scrolled away,
 * so on a long roster you could not see what you had searched for or which
 * filter was applied without scrolling back to the top.
 */
export default function ClientsIndex() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientListFilter>('all');
  const { loading, error, items, total, isEmpty, isNoMatch, selfItem, refetch } = useClientList(
    auth.user?.id,
    search,
    filter,
  );

  const goInvite = () => router.push('/(app)/clients/invite');

  return (
    <Screen padded={false}>
      <ScreenHeader
        title={t('clients.title')}
        action={
          <IconButton icon="plus" accessibilityLabel={t('clients.invite.title')} onPress={goInvite} />
        }
      >
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('clients.searchPlaceholder')}
        />
        <SegmentedPill
          items={FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
          selected={filter}
          onChange={(v) => setFilter(v as ClientListFilter)}
        />
      </ScreenHeader>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[6],
          gap: theme.space[3],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <OfflineStatusChip />

        {/*
          The PT's own record sits ABOVE the loading/error/empty/no-match
          ternary, not inside its list branch. A PT who only trains themselves
          has an empty roster by definition, so a row rendered in the list
          branch would be invisible in exactly the state that needs it — and
          typing any non-matching search would hide it too.
        */}
        {selfItem !== null ? (
          <SectionCard>
            <ListRow
              leading={
                <Avatar
                  size={36}
                  name={auth.user?.display_name}
                  photoUrl={selfItem.avatarUrl}
                />
              }
              title={t('me.label')}
              subtitle={t('me.subtitle')}
              trailing={<Tag label={t('me.pinnedTag')} tone="accent" />}
              minHeight={68}
              isLast
              onPress={() => router.push('/(app)/me')}
            />
          </SectionCard>
        ) : null}

        {loading ? (
          <SectionCard>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow isLast />
          </SectionCard>
        ) : error ? (
          <EmptyState
            icon="alert"
            tone="danger"
            title={t('clients.offlineError.title')}
            body={t('clients.offlineError.body')}
            actionLabel={t('clients.offlineError.retry')}
            actionVariant="ghost"
            onAction={() => void refetch()}
          />
        ) : isEmpty ? (
          <EmptyState
            icon="users"
            title={t('clients.empty.title')}
            body={t('clients.empty.body')}
            actionLabel={t('clients.empty.inviteButton')}
            onAction={goInvite}
          />
        ) : isNoMatch ? (
          <EmptyState
            icon="search"
            title={t('clients.noMatch.title', { query: search })}
            body={t('clients.noMatch.body')}
            actionLabel={t('clients.noMatch.inviteButton')}
            actionVariant="ghost"
            onAction={goInvite}
          />
        ) : (
          <View style={{ gap: theme.space[3] }}>
            <SectionCard>
              {items.map((item, index) => (
                <ClientRow key={item.id} item={item} isLast={index === items.length - 1} />
              ))}
            </SectionCard>
            <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {t('clients.countFooter', { shown: items.length, total })}
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../lib/auth/AuthProvider';
import { type ClientListFilter, useClientList } from '../../../lib/clients/useClientList';
import { useTheme } from '../../../theme/ThemeProvider';
import { Banner, Button, ListRow, Row, SectionCard, SegmentedPill, Screen, Skeleton, Text, TextField } from '../../../ui';

const FILTERS: { value: ClientListFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'clients.filters.all' },
  { value: 'active', labelKey: 'clients.filters.active' },
  { value: 'paused', labelKey: 'clients.filters.paused' },
  { value: 'invited', labelKey: 'clients.filters.invited' },
];

/**
 * PT client list — the prototype's `clients` screen drawn as exactly five
 * states behind one set of filter chips: loading, empty, no-match, offline
 * error, and populated. All five render from this one screen/hook pair
 * rather than five separate mockup routes.
 */
export default function ClientsIndex() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientListFilter>('all');
  const { loading, error, items, isEmpty, isNoMatch, refetch } = useClientList(auth.user?.id, search, filter);

  const stateDotColor = (state: string) => {
    if (state === 'active') return theme.colors.accent;
    if (state === 'deactivated') return theme.colors.dangerAccent;
    return theme.colors.textMuted;
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text variant="h1">{t('clients.title')}</Text>
          <Button label={t('clients.inviteAction')} onPress={() => router.push('/(app)/clients/invite')} />
        </Row>

        <TextField
          label={t('clients.searchPlaceholder')}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <SegmentedPill
          items={FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))}
          selected={filter}
          onChange={(v) => setFilter(v as ClientListFilter)}
        />

        {loading ? (
          <SectionCard>
            <Skeleton height={68} />
            <Skeleton height={68} />
            <Skeleton height={68} />
          </SectionCard>
        ) : error ? (
          <View style={{ gap: theme.space[3] }}>
            <Banner variant="danger" message={t('clients.offlineError.body')} />
            <Button label={t('clients.offlineError.retry')} variant="ghost" onPress={() => void refetch()} />
          </View>
        ) : isEmpty ? (
          <View style={{ gap: theme.space[3], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Text variant="h3">{t('clients.empty.title')}</Text>
            <Text tone="secondary">{t('clients.empty.body')}</Text>
            <Button label={t('clients.empty.inviteButton')} onPress={() => router.push('/(app)/clients/invite')} />
          </View>
        ) : isNoMatch ? (
          <View style={{ gap: theme.space[3], alignItems: 'center', paddingVertical: theme.space[8] }}>
            <Text variant="h3">{t('clients.noMatch.title', { query: search })}</Text>
            <Text tone="secondary">{t('clients.noMatch.body')}</Text>
            <Button label={t('clients.noMatch.inviteButton')} onPress={() => router.push('/(app)/clients/invite')} />
          </View>
        ) : (
          <SectionCard>
            {items.map((item) => (
              <ListRow
                key={item.id}
                minHeight={68}
                title={item.displayName}
                subtitle={t(`clients.stateLabels.${item.state}`)}
                trailing={
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: stateDotColor(item.state),
                    }}
                  />
                }
                onPress={() => router.push({ pathname: '/(app)/clients/[id]', params: { id: item.id } })}
              />
            ))}
          </SectionCard>
        )}
      </ScrollView>
    </Screen>
  );
}

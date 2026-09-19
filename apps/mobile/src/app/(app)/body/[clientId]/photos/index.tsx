import { GUIDED_POSES, type PhotoPose } from '@forge/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../../../lib/auth/AuthProvider';
import { backToMetrics } from '../../../../../lib/body/bodyBack';
import type { ProgressPhotoRow } from '../../../../../lib/body/bodyApi';
import { usePhotos } from '../../../../../lib/body/usePhotos';
import { useSignedUrls } from '../../../../../lib/body/useSignedUrls';
import { NeedsConnection } from '../../../../../lib/offline/NeedsConnection';
import { useTheme } from '../../../../../theme/ThemeProvider';
import { Banner, Button, ChipRow, EmptyState, FooterBar, Icon, NavHeader, Screen, SectionLabel, Skeleton, Text } from '../../../../../ui';

type Filter = 'all' | PhotoPose;

function groupByDay(rows: ProgressPhotoRow[]): { day: string; rows: ProgressPhotoRow[] }[] {
  const out: { day: string; rows: ProgressPhotoRow[] }[] = [];
  for (const r of rows) {
    const day = new Date(r.taken_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const last = out.at(-1);
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

export default function PhotoTimeline() {
  return (
    <NeedsConnection pushed>
      <PhotoTimelineInner />
    </NeedsConnection>
  );
}

function PhotoTimelineInner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const viewerIsClient = auth.user?.role === 'client';
  const photos = usePhotos(clientId);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = filter === 'all' ? photos.rows : photos.rows.filter((r) => r.pose_type === filter);
  const signed = useSignedUrls(rows.map((r) => r.thumbnail_path));
  const filters: Filter[] = ['all', ...GUIDED_POSES];
  const filterLabel = (f: Filter) => (f === 'all' ? t('body.photos.all') : t(`body.photos.pose.${f}`));
  const days = new Set(rows.map((r) => r.taken_at.slice(0, 10)));

  return (
    <Screen padded={false}>
      <NavHeader
        leading={
          <Button label={t('common.back')} variant="link" icon="chevronBack" onPress={() => clientId && backToMetrics(clientId)} />
        }
        title={t('body.photos.title')}
        divider
      />
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
        <ChipRow
          options={filters.map(filterLabel)}
          selected={[filterLabel(filter)]}
          onToggle={(opt) => setFilter(filters.find((f) => filterLabel(f) === opt) ?? 'all')}
        />
        {photos.loading ? <Skeleton height={160} radius={14} /> : null}
        {photos.error ? <Banner variant="danger" message={t('body.photos.loadError')} /> : null}
        {!photos.loading && !photos.error && rows.length === 0 ? (
          <EmptyState icon="user" title={t('body.photos.emptyTitle')} body={t('body.photos.emptyBody')} />
        ) : null}
        {groupByDay(rows).map((g) => (
          <View key={g.day} style={{ gap: theme.space[2] }}>
            <SectionLabel>{g.day}</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {g.rows.map((r) => {
                const url = signed.urls[r.thumbnail_path];
                return (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(`body.photos.pose.${r.pose_type}`)}
                    onPress={() => router.push({ pathname: '/(app)/body/[clientId]/photos/[photoId]', params: { clientId, photoId: r.id } })}
                    style={{ width: '31%', aspectRatio: 3 / 4, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}
                  >
                    {url ? <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" onError={signed.resign} /> : null}
                    <View style={{ position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
                      {viewerIsClient && !r.is_shared_with_pt ? (
                        <Icon name="shield" size={14} color="#FFFFFF" accessibilityLabel={t('body.photos.private')} />
                      ) : null}
                      <Text variant="caption" style={{ color: '#FFFFFF' }}>
                        {t(`body.photos.pose.${r.pose_type}`)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
      <FooterBar>
        <Button
          label={t('body.photos.take')}
          size="lg"
          onPress={() =>
            router.push({
              pathname: '/(app)/body/[clientId]/photos/capture',
              params: { clientId, ...(filter !== 'all' ? { pose: filter } : {}) },
            })
          }
        />
        <Button
          label={t('body.photos.compare')}
          variant="ghost"
          disabled={days.size < 2}
          onPress={() => router.push({ pathname: '/(app)/body/[clientId]/photos/compare', params: { clientId } })}
        />
      </FooterBar>
    </Screen>
  );
}

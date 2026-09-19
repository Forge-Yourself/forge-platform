import { bodyToDisplay, bodyUnit, formatBody, GUIDED_POSES, metricPoints, nearestValue, type PhotoPose, type UnitSystem } from '@forge/shared';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../../../lib/auth/AuthProvider';
import { backToPhotos } from '../../../../../lib/body/bodyBack';
import type { ProgressPhotoRow } from '../../../../../lib/body/bodyApi';
import { useBodyMetrics } from '../../../../../lib/body/useBodyMetrics';
import { usePhotos } from '../../../../../lib/body/usePhotos';
import { useSignedUrls } from '../../../../../lib/body/useSignedUrls';
import { NeedsConnection } from '../../../../../lib/offline/NeedsConnection';
import { useTheme } from '../../../../../theme/ThemeProvider';
import { Button, EmptyState, NavHeader, Screen, SectionLabel, SegmentedPill, Text } from '../../../../../ui';

export default function ComparePhotos() {
  return (
    <NeedsConnection pushed>
      <CompareInner />
    </NeedsConnection>
  );
}

/**
 * Two photos of one pose side by side, with the weight measured nearest each
 * (within 7 days). Before/After are picked from thumbnail strips of that pose
 * (plan correction: a date picker would offer dates with no photo).
 */
function CompareInner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const unit: UnitSystem = (auth.user?.unit_system as UnitSystem | undefined) ?? 'metric';
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const photos = usePhotos(clientId);
  const metrics = useBodyMetrics(clientId, 104);
  const [pose, setPose] = useState<PhotoPose>('front');
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);

  const ofPose = photos.rows.filter((r) => r.pose_type === pose).slice().reverse(); // oldest first
  const before = ofPose.find((r) => r.id === beforeId) ?? ofPose[0] ?? null;
  const after = ofPose.find((r) => r.id === afterId) ?? ofPose.at(-1) ?? null;
  const pair = before && after && before.id !== after.id ? [before, after] : [];
  const signed = useSignedUrls([...pair.map((p) => p.photo_path), ...ofPose.map((p) => p.thumbnail_path)]);
  const weights = metricPoints(metrics.rows, 'weight');

  const weightAt = (p: ProgressPhotoRow) => {
    const v = nearestValue(weights, Date.parse(p.taken_at), 7);
    return v === null ? t('body.photos.compareScreen.noWeight') : `${formatBody(bodyToDisplay('weight', v, unit), 'weight', unit)} ${bodyUnit('weight', unit)}`;
  };

  const strip = (selected: ProgressPhotoRow | null, onPick: (id: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, height: 92 }} contentContainerStyle={{ gap: theme.space[2], alignItems: 'center' }}>
      {ofPose.map((p) => {
        const url = signed.urls[p.thumbnail_path];
        const on = selected?.id === p.id;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={new Date(p.taken_at).toLocaleDateString()}
            onPress={() => onPick(p.id)}
            style={{ width: 66, height: 88, borderRadius: theme.radius.sm, overflow: 'hidden', borderWidth: 2, borderColor: on ? theme.colors.accent : 'transparent', backgroundColor: theme.colors.surfaceSunken }}
          >
            {url ? <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="cover" /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const column = (label: string, p: ProgressPhotoRow) => (
    <View style={{ flex: 1, gap: 4 }}>
      <SectionLabel>{label}</SectionLabel>
      <View style={{ aspectRatio: 3 / 4, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        {signed.urls[p.photo_path] ? (
          <Image source={{ uri: signed.urls[p.photo_path] }} style={{ flex: 1 }} contentFit="cover" onError={signed.resign} />
        ) : null}
      </View>
      <Text variant="caption">{new Date(p.taken_at).toLocaleDateString()}</Text>
      <Text variant="bodyBold" numeric>
        {weightAt(p)}
      </Text>
    </View>
  );

  return (
    <Screen padded={false}>
      <NavHeader
        leading={<Button label={t('common.back')} variant="link" icon="chevronBack" onPress={() => clientId && backToPhotos(clientId)} />}
        title={t('body.photos.compareScreen.title')}
        divider
      />
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[4] }}>
        <SegmentedPill
          items={GUIDED_POSES.map((p) => ({ label: t(`body.photos.pose.${p}`), value: p }))}
          selected={pose}
          onChange={(v) => {
            setPose(v as PhotoPose);
            setBeforeId(null);
            setAfterId(null);
          }}
        />
        {pair.length === 2 ? (
          <>
            <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
              {column(t('body.photos.compareScreen.before'), pair[0]!)}
              {column(t('body.photos.compareScreen.after'), pair[1]!)}
            </View>
            <SectionLabel>{t('body.photos.compareScreen.before')}</SectionLabel>
            {strip(before, setBeforeId)}
            <SectionLabel>{t('body.photos.compareScreen.after')}</SectionLabel>
            {strip(after, setAfterId)}
          </>
        ) : (
          <EmptyState icon="user" title={t('body.photos.compareScreen.title')} body={t('body.photos.compareScreen.needTwo')} />
        )}
      </ScrollView>
    </Screen>
  );
}

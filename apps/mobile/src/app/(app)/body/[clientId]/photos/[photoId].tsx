import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../../../../lib/auth/AuthProvider';
import { backToPhotos } from '../../../../../lib/body/bodyBack';
import { deleteProgressPhoto, setPhotoShared } from '../../../../../lib/body/bodyApi';
import { usePhotos } from '../../../../../lib/body/usePhotos';
import { useSignedUrls } from '../../../../../lib/body/useSignedUrls';
import { NeedsConnection } from '../../../../../lib/offline/NeedsConnection';
import { useTheme } from '../../../../../theme/ThemeProvider';
import { Banner, Button, Card, EmptyState, NavHeader, Row, Screen, Skeleton, Text, Toggle } from '../../../../../ui';

export default function PhotoDetail() {
  return (
    <NeedsConnection pushed>
      <PhotoDetailInner />
    </NeedsConnection>
  );
}

function PhotoDetailInner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const { clientId, photoId } = useLocalSearchParams<{ clientId: string; photoId: string }>();
  const viewerIsClient = auth.user?.role === 'client';
  const photos = usePhotos(clientId);
  const photo = photos.rows.find((r) => r.id === photoId) ?? null;
  const signed = useSignedUrls(photo ? [photo.photo_path] : []);
  const url = photo ? signed.urls[photo.photo_path] : undefined;
  const [shared, setShared] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = <Button label={t('common.back')} variant="link" icon="chevronBack" onPress={() => clientId && backToPhotos(clientId)} />;

  if (photos.loading) {
    return (
      <Screen>
        <NavHeader leading={back} />
        <Skeleton height={420} radius={14} />
      </Screen>
    );
  }
  if (!photo) {
    return (
      <Screen>
        <NavHeader leading={back} />
        <EmptyState icon="alert" title={t('body.photos.unavailable')} body={t('body.photos.loadError')} />
      </Screen>
    );
  }

  const isShared = shared ?? photo.is_shared_with_pt;
  const takenBy =
    photo.taken_by_user_id === auth.user?.id
      ? t('body.photos.detail.takenByYou')
      : viewerIsClient
        ? t('body.photos.detail.takenByPt')
        : t('body.photos.detail.takenByClient');
  const canDelete = viewerIsClient || photo.taken_by_user_id === auth.user?.id;

  const toggleShare = async (next: boolean) => {
    setShared(next);
    setError(null);
    const r = await setPhotoShared(photo.id, next);
    if (r.error) {
      setShared(!next);
      setError(t('body.photos.detail.error'));
    }
  };

  const remove = async () => {
    setBusy(true);
    const { error: e } = await deleteProgressPhoto(photo);
    setBusy(false);
    if (e) {
      setError(t('body.photos.detail.error'));
      return;
    }
    if (clientId) backToPhotos(clientId);
  };

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t(`body.photos.pose.${photo.pose_type}`)} divider />
      <ScrollView contentContainerStyle={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={{ aspectRatio: 3 / 4, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          {url ? <Image source={{ uri: url }} style={{ flex: 1 }} contentFit="contain" onError={signed.resign} /> : null}
        </View>
        <Text variant="bodyBold">{new Date(photo.taken_at).toLocaleString()}</Text>
        <Text variant="caption" tone="muted">
          {takenBy}
        </Text>
        {viewerIsClient ? (
          <Toggle label={t('body.photos.detail.share')} value={isShared} onValueChange={(v) => void toggleShare(v)} />
        ) : null}
        {error ? <Banner variant="danger" message={error} /> : null}
        {canDelete ? (
          confirming ? (
            <Card>
              <Text variant="bodyBold">{t('body.photos.detail.deleteTitle')}</Text>
              <Text tone="secondary">{t('body.photos.detail.deleteBody')}</Text>
              <Row style={{ gap: theme.space[2], marginTop: theme.space[3] }}>
                <Button label={t('common.cancel')} variant="link" onPress={() => setConfirming(false)} />
                <Button label={t('body.photos.detail.delete')} variant="ghost" tone="danger" loading={busy} onPress={() => void remove()} />
              </Row>
            </Card>
          ) : (
            <Button label={t('body.photos.detail.delete')} variant="link" tone="danger" onPress={() => setConfirming(true)} />
          )
        ) : null}
      </ScrollView>
    </Screen>
  );
}

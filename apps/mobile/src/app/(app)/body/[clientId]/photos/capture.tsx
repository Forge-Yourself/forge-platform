import { GUIDED_POSES, photoPoseSchema, type PhotoPose } from '@forge/shared';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { useAuth } from '../../../../../lib/auth/AuthProvider';
import { backToPhotos } from '../../../../../lib/body/bodyBack';
import { PoseGuide } from '../../../../../lib/body/PoseGuide';
import { uploadProgressPhoto, type SourceImage } from '../../../../../lib/body/photoUpload';
import { usePhotos } from '../../../../../lib/body/usePhotos';
import { useSignedUrls } from '../../../../../lib/body/useSignedUrls';
import { useOffline } from '../../../../../lib/offline/offlineContext';
import { useTheme } from '../../../../../theme/ThemeProvider';
import { Banner, Button, EmptyState, FooterBar, IconButton, NavHeader, Screen, SegmentedPill, Text, Toggle } from '../../../../../ui';

const POSES: readonly PhotoPose[] = photoPoseSchema.options;

/**
 * Live camera with the pose silhouette and a ghost of the last photo of the
 * same pose (spec D6). Online only (D3): Use photo is disabled without a
 * connection. The photo id is minted per captured image and reused on retry.
 */
export default function CapturePhoto() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const { clientId, pose: poseParam } = useLocalSearchParams<{ clientId: string; pose?: string }>();
  const viewerIsClient = auth.user?.role === 'client';
  // A PT photographing THEMSELVES is a third case, not either of the two this
  // screen was built for: the camera should face them like a client's does,
  // but a "share with your trainer" toggle pointed at yourself is nonsense —
  // record_progress_photo honours p_share here (is_client_record_owner is true
  // for a self row), so the photo simply stays private and says so.
  const subjectIsSelf = clientId === auth.selfClientId;
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const initialPose = GUIDED_POSES.find((p) => p === poseParam) ?? 'front';
  const [pose, setPose] = useState<PhotoPose>(initialPose);
  const [facing, setFacing] = useState<CameraType>(viewerIsClient || subjectIsSelf ? 'front' : 'back');
  const [ghostOn, setGhostOn] = useState(true);
  const [captured, setCaptured] = useState<SourceImage | null>(null);
  const [photoId, setPhotoId] = useState(() => Crypto.randomUUID());
  const [takenAt, setTakenAt] = useState(() => new Date().toISOString());
  const [share, setShare] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photos = usePhotos(clientId);
  const lastOfPose = photos.rows.find((p) => p.pose_type === pose);
  const ghost = useSignedUrls(ghostOn && lastOfPose ? [lastOfPose.thumbnail_path] : []);
  const ghostUrl = lastOfPose ? ghost.urls[lastOfPose.thumbnail_path] : undefined;

  const keep = (img: SourceImage) => {
    setCaptured(img);
    setPhotoId(Crypto.randomUUID());
    setTakenAt(new Date().toISOString());
    setError(null);
  };

  const shoot = async () => {
    const pic = await camera.current?.takePictureAsync({ quality: 0.9 });
    if (pic) keep({ uri: pic.uri, width: pic.width, height: pic.height });
  };

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) keep({ uri: asset.uri, width: asset.width, height: asset.height });
  };

  const use = async () => {
    if (!captured || !clientId) return;
    setUploading(true);
    setError(null);
    const r = await uploadProgressPhoto({ photoId, clientId, pose, share, source: captured, takenAt });
    setUploading(false);
    if (r.error || !r.photo) {
      setError(t('body.photos.capture.uploadError'));
      return;
    }
    // dismissTo, not push: a submit that changed state must not stack the
    // form under the result (PITFALLS "replace not push").
    backToPhotos(clientId);
  };

  const back = (
    <Button label={t('common.back')} variant="link" icon="chevronBack" onPress={() => clientId && backToPhotos(clientId)} />
  );

  const poseItems = (captured ? POSES : GUIDED_POSES).map((p) => ({ label: t(`body.photos.pose.${p}`), value: p }));

  if (!captured && permission && !permission.granted) {
    return (
      <Screen>
        <NavHeader leading={back} title={t('body.photos.capture.title')} />
        <EmptyState
          icon="alert"
          title={t('body.photos.capture.permissionTitle')}
          body={t('body.photos.capture.permissionBody')}
          actionLabel={permission.canAskAgain ? t('body.photos.capture.permissionGrant') : t('body.photos.capture.openSettings')}
          onAction={() => void (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
        />
        <Button label={t('body.photos.capture.library')} variant="ghost" onPress={() => void pick()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <NavHeader leading={back} title={t('body.photos.capture.title')} />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[3] }}>
        <SegmentedPill items={poseItems} selected={pose} onChange={(v) => setPose(v as PhotoPose)} />
      </View>

      <View style={{ flex: 1, marginHorizontal: theme.space[4], borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: '#000' }}>
        {captured ? (
          <Image source={{ uri: captured.uri }} style={{ flex: 1 }} contentFit="contain" />
        ) : (
          <>
            <CameraView ref={camera} style={{ flex: 1 }} facing={facing} />
            {ghostUrl ? (
              <Image
                source={{ uri: ghostUrl }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.3 }}
                contentFit="cover"
                onError={ghost.resign}
              />
            ) : null}
            <PoseGuide pose={pose} />
            <View style={{ position: 'absolute', top: theme.space[3], right: theme.space[3] }}>
              <IconButton
                icon="flip"
                variant="ghost"
                accessibilityLabel={t('body.photos.capture.flip')}
                onPress={() => setFacing((f) => (f === 'front' ? 'back' : 'front'))}
              />
            </View>
          </>
        )}
      </View>

      <FooterBar>
        {captured ? (
          <>
            {viewerIsClient ? (
              <Toggle label={t('body.photos.capture.share')} value={share} onValueChange={setShare} />
            ) : (
              <Text variant="caption" tone="muted">
                {t(subjectIsSelf ? 'body.photos.capture.selfNote' : 'body.photos.capture.ptNote')}
              </Text>
            )}
            {error ? <Banner variant="danger" message={error} /> : null}
            <Button
              label={offline.online ? t('body.photos.capture.use') : t('body.photos.capture.needsConnection')}
              size="lg"
              loading={uploading}
              disabled={!offline.online || uploading}
              onPress={() => void use()}
            />
            <Button label={t('body.photos.capture.retake')} variant="link" disabled={uploading} onPress={() => setCaptured(null)} />
          </>
        ) : (
          <>
            {lastOfPose ? (
              <Toggle label={t('body.photos.capture.ghost')} value={ghostOn} onValueChange={setGhostOn} />
            ) : null}
            <Button label={t('body.photos.capture.shutter')} size="lg" icon="plus" onPress={() => void shoot()} />
            <Button label={t('body.photos.capture.library')} variant="link" onPress={() => void pick()} />
          </>
        )}
      </FooterBar>
    </Screen>
  );
}

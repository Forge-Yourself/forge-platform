import { base64ToBytes, photoObjectPaths, PROGRESS_PHOTO_BUCKET, type PhotoPose } from '@forge/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../supabase';
import { recordProgressPhoto, type ProgressPhotoRow } from './bodyApi';

export type SourceImage = { uri: string; width: number; height: number };

const FULL_EDGE = 2048;
const THUMB_EDGE = 360;

/**
 * Resize and re-encode on the device (spec D6). Re-encoding drops EXIF,
 * including GPS, on native and web alike. Never upscales.
 */
async function render(src: SourceImage, longEdge: number, compress: number): Promise<Uint8Array> {
  const ctx = ImageManipulator.manipulate(src.uri);
  const known = src.width > 0 && src.height > 0;
  if (!known || Math.max(src.width, src.height) > longEdge) {
    ctx.resize(!known || src.width >= src.height ? { width: longEdge } : { height: longEdge });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
  if (!saved.base64) throw new Error('image manipulator returned no base64');
  return base64ToBytes(saved.base64);
}

/** A retry after a partial upload finds the object already there; that is success. */
function alreadyThere(error: { message?: string } | null): boolean {
  return !!error && /exists|duplicate/i.test(error.message ?? '');
}

/**
 * Upload full + thumb, then register the row. `photoId` is minted once per
 * captured image by the screen and reused on retry, so every step is
 * idempotent: objects that already exist count as uploaded, and
 * record_progress_photo returns the existing row.
 */
export async function uploadProgressPhoto(args: {
  photoId: string;
  clientId: string;
  pose: PhotoPose;
  share: boolean;
  source: SourceImage;
  takenAt: string;
}): Promise<{ photo: ProgressPhotoRow | null; error: Error | null }> {
  try {
    const paths = photoObjectPaths(args.clientId, args.photoId);
    const [full, thumb] = await Promise.all([render(args.source, FULL_EDGE, 0.8), render(args.source, THUMB_EDGE, 0.7)]);
    const bucket = supabase.storage.from(PROGRESS_PHOTO_BUCKET);
    for (const [path, bytes] of [
      [paths.full, full],
      [paths.thumb, thumb],
    ] as const) {
      const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (error && !alreadyThere(error)) return { photo: null, error };
    }
    const r = await recordProgressPhoto({
      id: args.photoId,
      clientId: args.clientId,
      pose: args.pose,
      takenAt: args.takenAt,
      share: args.share,
    });
    return { photo: r.row, error: r.error };
  } catch (e) {
    return { photo: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

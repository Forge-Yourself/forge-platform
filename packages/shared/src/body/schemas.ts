import { z } from 'zod';
import { CIRCUMFERENCE_SITES } from './metrics';

const cm = z.number().min(10).max(300);

/** Keys and bounds match 0017's body_circumferences_valid(). */
const circumferencesSchema = z
  .strictObject({ waist: cm, hips: cm, chest: cm, arm: cm, thigh: cm, neck: cm } satisfies Record<(typeof CIRCUMFERENCE_SITES)[number], typeof cm>)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty' });

export const bodyMetricInputSchema = z
  .object({
    id: z.uuid(),
    client_id: z.uuid(),
    measured_at: z.iso.datetime({ offset: true }).nullable(),
    weight_kg: z.number().gt(0).lt(500).nullable(),
    body_fat_pct: z.number().min(0).max(100).nullable(),
    circumferences: circumferencesSchema.nullable(),
    note: z.string().max(500).nullable(),
  })
  .refine((v) => v.weight_kg !== null || v.body_fat_pct !== null || v.circumferences !== null, {
    message: 'empty',
  });
export type BodyMetricInput = z.infer<typeof bodyMetricInputSchema>;

export const photoPoseSchema = z.enum(['front', 'back', 'side_left', 'side_right', 'custom']);
export type PhotoPose = z.infer<typeof photoPoseSchema>;
/** The poses with a silhouette guide. `custom` is a library import that matched none. */
export const GUIDED_POSES = ['front', 'back', 'side_left', 'side_right'] as const satisfies readonly PhotoPose[];

export const PROGRESS_PHOTO_BUCKET = 'progress-photos';

/** The only object names 0017's INSERT policy accepts. */
export function photoObjectPaths(clientId: string, photoId: string): { full: string; thumb: string } {
  return { full: `${clientId}/${photoId}/full.jpg`, thumb: `${clientId}/${photoId}/thumb.jpg` };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * expo-image-manipulator hands back base64; Storage wants bytes. Written out
 * rather than leaning on atob so it behaves the same under Hermes, the browser
 * and vitest.
 */
export function base64ToBytes(input: string): Uint8Array {
  const b64 = input.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((b64.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of b64) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

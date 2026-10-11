import { requireOptionalNativeModule } from 'expo';
import { Platform, Share } from 'react-native';

type SharingModule = {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(url: string, options?: { mimeType?: string; UTI?: string; dialogTitle?: string }): Promise<void>;
};

/**
 * expo-sharing is a native module added in M5c, so a dev client built before
 * it throws at import time. Required only when the native side exists
 * (PITFALLS R3): an old build falls back to the share sheet with the text.
 */
function sharing(): SharingModule | null {
  if (requireOptionalNativeModule('ExpoSharing') === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay conditional; see above
  return require('expo-sharing') as SharingModule;
}

/**
 * Hands an .ics file to the platform (M5c spec D16): a download on web; on a
 * device, a file in the cache directory passed to the share sheet, where
 * Calendar, Google Calendar and Outlook offer to import it.
 */
export async function shareIcs(filename: string, text: string, dialogTitle: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(text);
    const s = sharing();
    if (s && (await s.isAvailableAsync())) {
      await s.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle });
      return true;
    }
  } catch {
    // Fall through to plain text.
  }
  await Share.share({ message: text, title: dialogTitle });
  return true;
}

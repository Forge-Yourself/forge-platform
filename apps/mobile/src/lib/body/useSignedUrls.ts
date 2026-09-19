import { useCallback, useEffect, useRef, useState } from 'react';
import { signPhotoPaths } from './bodyApi';

/**
 * Signs the given object paths in one createSignedUrls call and re-signs when
 * the list changes. A signed URL lives 60 s; an <Image> that fails calls
 * `resign()` once, and a second failure is left to the "unavailable" tile.
 * Only the newest request may set state (O1).
 */
export function useSignedUrls(paths: string[]): { urls: Record<string, string>; error: string | null; resign: () => void } {
  const key = paths.join('|');
  const [state, setState] = useState<{ urls: Record<string, string>; error: string | null }>({ urls: {}, error: null });
  const [tick, setTick] = useState(0);
  const resigned = useRef(new Set<string>());
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const list = key === '' ? [] : key.split('|');
    void signPhotoPaths(list).then((r) => {
      if (mine === seq.current) setState(r);
    });
  }, [key, tick]);

  const resign = useCallback(() => {
    if (resigned.current.has(key)) return;
    resigned.current.add(key);
    setTick((n) => n + 1);
  }, [key]);

  return { ...state, resign };
}

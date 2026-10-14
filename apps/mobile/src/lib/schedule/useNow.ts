import { useEffect, useState } from 'react';

/**
 * A clock for render. React Compiler's purity rule forbids Date.now() in a
 * render body, and the schedule needs "now" for the now line, the no-show
 * unlock and the cancel deadline. Ticks every `ms`; setState only happens in
 * the interval callback, never synchronously in the effect.
 */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

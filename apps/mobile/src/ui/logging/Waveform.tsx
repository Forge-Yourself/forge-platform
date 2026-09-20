import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

const BARS = 28;

/** Prototype `voice`: bars that follow the input level. Decorative: hidden from screen readers. */
export function Waveform({ level, active, color }: { level: number; active: boolean; color: string }) {
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: BARS }, () => 0));
  // Read through a ref inside the interval so `level` (which changes ~10x/second
  // while listening) does not tear the interval down and rebuild it every tick.
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setHistory((h) => [...h.slice(1), levelRef.current]), 90);
    return () => clearInterval(id);
  }, [active]);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 64 }}
    >
      {history.map((v, i) => (
        <View key={i} style={{ width: 4, borderRadius: 2, height: 6 + Math.round(v * 56), backgroundColor: color, opacity: active ? 1 : 0.35 }} />
      ))}
    </View>
  );
}

import { useEffect, useState } from 'react';
import { View } from 'react-native';

const BARS = 28;

/** Prototype `voice`: bars that follow the input level. Decorative: hidden from screen readers. */
export function Waveform({ level, active, color }: { level: number; active: boolean; color: string }) {
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: BARS }, () => 0));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setHistory((h) => [...h.slice(1), level]), 90);
    return () => clearInterval(id);
  }, [active, level]);
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

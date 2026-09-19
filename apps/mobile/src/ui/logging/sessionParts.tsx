import { Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../Text';

/** The prototype's 11/700 uppercase section rule on the summary. */
export function Kicker({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: theme.colors.textMuted,
        marginBottom: 9,
      }}
    >
      {children}
    </Text>
  );
}

/** 9.5/700 tracked label used on the LAST SESSION / BEST / COACH CUE tiles. */
export function MicroLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 1.1, color: theme.colors.textMuted }}>
      {children}
    </Text>
  );
}

export function InfoTile({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        backgroundColor: theme.colors.surfaceSunken,
        borderRadius: 10,
        paddingVertical: 9,
        paddingHorizontal: 11,
      }}
    >
      <MicroLabel>{label}</MicroLabel>
      <Text numeric numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', marginTop: 3 }}>
        {value}
      </Text>
    </View>
  );
}

export function SummaryStat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 13,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Text numeric numberOfLines={1} style={{ fontSize: 20, fontWeight: '700', lineHeight: 22 }}>
        {value}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontSize: 9.5, fontWeight: '600', letterSpacing: 1, color: theme.colors.textMuted, marginTop: 6 }}
      >
        {label}
      </Text>
    </View>
  );
}

export function GhostTile({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 44,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary }}>{label}</Text>
    </Pressable>
  );
}

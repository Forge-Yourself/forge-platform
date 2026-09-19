import { colorSchemes } from '@forge/shared';
import { Modal, Pressable, View } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';

export type PrMomentProps = {
  visible: boolean;
  kicker: string;
  /** The headline figure, e.g. "102.5". */
  value: string;
  /** Trailing unit on the headline, e.g. "kg"; empty for a reps-only record. */
  unit: string;
  /** "× 8 reps @ RPE 8" */
  detail: string;
  exercise: string;
  /** The record this one broke, struck through, with its delta — null on a first record. */
  previous: { struck: string; delta: string } | null;
  /** "Set 12 Aug · 28 days ago" — when the previous record was set. */
  since: string | null;
  /** Any further records the same set broke (reps, volume), one line each. */
  extras: readonly string[];
  keepGoingLabel: string;
  onClose: () => void;
};

/**
 * Prototype `pr`: a full-screen takeover on the dark surface. It interrupts on
 * purpose, once per record. The number is 56px mono and the previous best is
 * struck through directly under it, so the delta reads without reading.
 * The artboard's "Share with <client>" is not here: sharing is M9 comms.
 */
export function PrMoment({
  visible,
  kicker,
  value,
  unit,
  detail,
  exercise,
  previous,
  since,
  extras,
  keepGoingLabel,
  onClose,
}: PrMomentProps) {
  const dark = colorSchemes.dark;
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View
        accessibilityViewIsModal
        style={{ flex: 1, backgroundColor: dark.surfaceSunken, paddingTop: 26, paddingHorizontal: 24, paddingBottom: 28 }}
      >
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <View
            style={{
              width: 144,
              height: 144,
              borderRadius: 72,
              backgroundColor: 'rgba(232,99,26,0.10)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 8,
            }}
          >
            <View
              style={{
                width: 112,
                height: 112,
                borderRadius: 56,
                borderWidth: 3,
                borderColor: dark.accent,
                backgroundColor: dark.surfaceSunken,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="flame" size={38} color={dark.accent} strokeWidth={2.2} />
            </View>
          </View>
          <Text
            accessibilityRole="header"
            style={{ color: dark.accent, fontSize: 12, fontWeight: '800', letterSpacing: 4, textAlign: 'center' }}
          >
            {kicker}
          </Text>
          <Text numeric style={{ color: dark.textPrimary, fontSize: 56, fontWeight: '700', lineHeight: 62, marginTop: 10 }}>
            {value}
            {unit ? <Text numeric style={{ fontSize: 24, color: dark.textMuted }}>{' ' + unit}</Text> : null}
          </Text>
          {detail ? (
            <Text style={{ color: dark.textSecondary, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{detail}</Text>
          ) : null}
          <Text style={{ color: dark.textMuted, fontSize: 15, marginTop: 18, textAlign: 'center' }}>{exercise}</Text>
          {previous ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <Text numeric style={{ color: dark.textMuted, fontSize: 14, textDecorationLine: 'line-through' }}>
                {previous.struck}
              </Text>
              <View
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  backgroundColor: dark.successSurface,
                }}
              >
                <Text numeric style={{ color: dark.onSuccessSurface, fontSize: 13, fontWeight: '700' }}>
                  {previous.delta}
                </Text>
              </View>
            </View>
          ) : null}
          {since ? <Text style={{ color: dark.textMuted, fontSize: 13, marginTop: 8 }}>{since}</Text> : null}
          {extras.map((line) => (
            <Text key={line} style={{ color: dark.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' }}>
              {line}
            </Text>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => ({
            minHeight: 54,
            borderRadius: 11,
            backgroundColor: dark.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          {/* Dark-scheme accent pair, not the artboard's white-on-#E8631A: white on
              ember-500 is under 4.5:1 at 16px (same call as RestTimer). */}
          <Text style={{ color: dark.onAccent, fontSize: 16, fontWeight: '700' }}>{keepGoingLabel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

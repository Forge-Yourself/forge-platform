import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Banner } from './Banner';
import { Row } from './Row';
import { Text } from './Text';

export type YesNoCardProps = {
  question: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
  /** Show the inline flag treatment when `value === true`. */
  flagged?: boolean;
  flaggedNote?: string;
};

function OptionButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: t.radius.md,
        borderWidth: 1.5,
        borderColor: selected ? t.colors.accent : t.colors.borderStrong,
        backgroundColor: selected ? t.colors.accentSurfaceSoft : 'transparent',
      }}
    >
      <Text variant="bodyBold" tone={selected ? 'accent' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The PAR-Q question card *(DS gap — M2)*: a question plus two 44pt Yes/No
 * targets. `accessibilityRole="radiogroup"`/`"radio"` mirrors `ChoiceCard`'s
 * existing pattern. When `flagged` is true (value === true and this question
 * is one of the seven PAR-Q items), an inline warn banner renders beneath —
 * warn, not danger, per the design's own reasoning: "the flags need reading,
 * not panic". The PT-facing intake review screen is what escalates a flagged
 * answer to the danger treatment; this card never does.
 */
export function YesNoCard({
  question,
  value,
  onChange,
  yesLabel = 'Yes',
  noLabel = 'No',
  flagged,
  flaggedNote,
}: YesNoCardProps) {
  const t = useTheme();

  return (
    <View accessibilityRole="radiogroup" style={{ gap: t.space[3] }}>
      <Text variant="body">{question}</Text>
      <Row style={{ gap: t.space[3] }}>
        <OptionButton label={yesLabel} selected={value === true} onPress={() => onChange(true)} />
        <OptionButton label={noLabel} selected={value === false} onPress={() => onChange(false)} />
      </Row>
      {value === true && flagged && flaggedNote ? <Banner variant="warn" message={flaggedNote} /> : null}
    </View>
  );
}

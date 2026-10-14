import { View } from 'react-native';
import { Banner, Text } from '../../ui';

/** The design's two-line offline strip: the kicker in a warn banner, the consequence under it. */
export function OfflineNote({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Banner variant="warn" message={title} />
      <Text variant="caption" tone="muted">
        {body}
      </Text>
    </View>
  );
}

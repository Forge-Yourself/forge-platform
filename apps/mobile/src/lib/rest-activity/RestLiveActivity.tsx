import { Button, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { buttonStyle, font, foregroundStyle, monospacedDigit, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type RestLiveProps = {
  sessionId: string;
  startedAt: number;
  endsAt: number;
  kicker: string;
  title: string;
  text: string;
  plus30: string;
  skip: string;
  /** Set by the Skip button with the app dead: the activity shows nothing left to count. */
  skipped?: boolean;
};

/**
 * Prototype `lock`: the timer keeps running with the phone in a pocket; +30s
 * and Skip work without unlocking. Each button's onPress return becomes the
 * activity's new props, which ActivityKit persists with no app process. The
 * app is told only while its process is alive (addUserInteractionListener).
 * That gap is recorded in the plan's Corrections §6.5.
 */
const RestLive = (props: RestLiveProps, env: LiveActivityEnvironment) => {
  'widget';
  const ember = env.isLuminanceReduced ? '#FFFFFF' : '#FF8A3D';
  const range = { lower: new Date(props.startedAt), upper: new Date(props.endsAt) };
  const clock = (size: number) =>
    props.skipped ? (
      <Text modifiers={[font({ size, weight: 'bold', design: 'monospaced' })]}>0:00</Text>
    ) : (
      <Text timerInterval={range} countsDown modifiers={[font({ size, weight: 'bold', design: 'monospaced' }), monospacedDigit()]} />
    );
  const plus = (
    <Button
      label={props.plus30}
      target={`plus30:${props.sessionId}`}
      modifiers={[buttonStyle('bordered')]}
      onPress={() => ({ ...props, endsAt: Math.max(props.endsAt, Date.now()) + 30_000 })}
    />
  );
  const skip = (
    <Button
      label={props.skip}
      target={`skip:${props.sessionId}`}
      modifiers={[buttonStyle('bordered')]}
      onPress={() => ({ ...props, skipped: true, endsAt: Date.now() })}
    />
  );
  return {
    banner: (
      <VStack modifiers={[padding({ all: 14 })]}>
        <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(ember)]}>{props.kicker}</Text>
        <HStack>
          {clock(40)}
          <Spacer />
          {plus}
          {skip}
        </HStack>
        <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>{props.title}</Text>
        <Text modifiers={[font({ size: 12 })]}>{props.text}</Text>
      </VStack>
    ),
    compactLeading: <Text modifiers={[foregroundStyle(ember)]}>●</Text>,
    compactTrailing: clock(14),
    minimal: clock(12),
    expandedLeading: clock(28),
    expandedTrailing: (
      <HStack>
        {plus}
        {skip}
      </HStack>
    ),
    expandedBottom: <Text modifiers={[font({ size: 12 })]}>{props.title}</Text>,
  };
};

export default createLiveActivity<RestLiveProps>('RestActivity', RestLive);

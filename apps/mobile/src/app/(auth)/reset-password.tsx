import { Screen, Text } from '../../ui';

/** Placeholder — real reset-password screen lands in Task 7. Reached via deep link
 * (lib/deepLinks.ts) after a recovery OTP is verified. */
export default function ResetPassword() {
  return (
    <Screen>
      <Text variant="h2">Reset password (Task 7)</Text>
    </Screen>
  );
}

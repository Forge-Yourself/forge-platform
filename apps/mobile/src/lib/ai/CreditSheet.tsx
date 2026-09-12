import { AI_CREDIT_PACKS } from '@forge/shared';
import { useTranslation } from 'react-i18next';
import { Modal, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, Row, Screen, SectionCard, ListRow, Text } from '../../ui';

export type CreditSheetProps = {
  visible: boolean;
  balance: number;
  onDismiss: () => void;
};

function priceLabel(priceCents: number): string {
  return '$' + (priceCents / 100).toFixed(0);
}

/**
 * The low-credit and out-of-credit sheet. Never a hard block: dismissing
 * returns the PT to a builder that still works, and the body copy says so in
 * as many words — building programs by hand is free and unlimited, and
 * credits only ever buy AI drafting.
 *
 * The purchase CTA is inert on purpose. RevenueCat lands at M6, and
 * ai_credit_packs has no writer until then; a button that looked live and
 * did nothing would be worse than one labelled "coming soon".
 */
export function CreditSheet({ visible, balance, onDismiss }: CreditSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onDismiss}>
      <Screen>
        <View style={{ gap: theme.space[4] }}>
          <Text variant="h2">
            {balance <= 0
              ? t('credits.empty')
              : t(balance === 1 ? 'credits.remaining_one' : 'credits.remaining_other', {
                  count: balance,
                })}
          </Text>

          {balance === 1 ? <Text tone="secondary">{t('credits.enoughForOne')}</Text> : null}

          <Text tone="secondary">{t('credits.body')}</Text>

          <SectionCard>
            {AI_CREDIT_PACKS.map((pack) => (
              <ListRow
                key={pack.tier}
                minHeight={68}
                title={t('credits.remaining_other', { count: pack.credits })}
                subtitle={t('credits.packs.' + pack.tier)}
                trailing={
                  <Row style={{ gap: theme.space[2], alignItems: 'center' }}>
                    <Text numeric variant="bodyBold">
                      {priceLabel(pack.priceCents)}
                    </Text>
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: theme.radius.sm,
                        backgroundColor: theme.colors.surfaceSunken,
                      }}
                    >
                      <Text variant="caption" tone="muted">
                        {t('credits.comingSoon')}
                      </Text>
                    </View>
                  </Row>
                }
              />
            ))}
          </SectionCard>

          <Button label={t('credits.dismiss')} variant="ghost" onPress={onDismiss} />
        </View>
      </Screen>
    </Modal>
  );
}

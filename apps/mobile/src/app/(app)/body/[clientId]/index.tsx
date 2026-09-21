import {
  bodyMetricInputSchema,
  bodyStep,
  bodyToDisplay,
  bodyToStored,
  bodyUnit,
  CHART_WINDOWS,
  DEFAULT_WINDOW,
  formatBody,
  historyRows,
  metricPayload,
  metricPoints,
  MORE_METRICS,
  plateau,
  PRIMARY_METRICS,
  seriesDelta,
  stepBody,
  weekLabels,
  windowPoints,
  type BodyMetricKey,
  type ChartWindow,
  type UnitSystem,
} from '@forge/shared';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useAuth } from '../../../../lib/auth/AuthProvider';
import { backFromBody, type BodyOrigin } from '../../../../lib/body/bodyBack';
import { deleteBodyMetric, recordBodyMetric } from '../../../../lib/body/bodyApi';
import { useBodyMetrics } from '../../../../lib/body/useBodyMetrics';
import { NeedsConnection } from '../../../../lib/offline/NeedsConnection';
import { useOffline } from '../../../../lib/offline/offlineContext';
import { useTheme } from '../../../../theme/ThemeProvider';
import {
  Banner,
  Button,
  Card,
  ChipRow,
  EmptyState,
  Icon,
  ListRow,
  MeasureStepper,
  NavHeader,
  Row,
  Screen,
  SectionCard,
  SectionLabel,
  SegmentedPill,
  Skeleton,
  Tag,
  Text,
  TextField,
  TrendChart,
} from '../../../../ui';

const WEEK = 7 * 86_400_000;

export default function BodyMetricsScreen() {
  return (
    <NeedsConnection pushed>
      <BodyMetricsInner />
    </NeedsConnection>
  );
}

/**
 * Prototype `metrics`, followed exactly where it is explicit: segmented
 * metric, chart and entry follow the selection, trend line only, ± stepper,
 * history repeats the delta per row. Serves both personas (spec §5).
 */
function BodyMetricsInner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const offline = useOffline();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const unit: UnitSystem = (auth.user?.unit_system as UnitSystem | undefined) ?? 'metric';
  const viewerIsClient = auth.user?.role === 'client';
  // Where Back goes. A PT on their OWN record is neither of the two cases this
  // screen was built for — see bodyBack.ts for why the boolean was not enough.
  const origin: BodyOrigin = viewerIsClient ? 'home' : clientId === auth.selfClientId ? 'me' : 'client';
  const data = useBodyMetrics(clientId);

  const [metric, setMetric] = useState<BodyMetricKey>('weight');
  const [weeks, setWeeks] = useState<ChartWindow>(DEFAULT_WINDOW);
  const [entry, setEntry] = useState<Partial<Record<BodyMetricKey, number>>>({});
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const label = (k: BodyMetricKey) => t(`body.metric.${k}`);
  const points = metricPoints(data.rows, metric);
  const windowed = windowPoints(points, weeks, data.loadedAt);
  const shown = windowed.map((p) => ({ ms: p.ms, value: bodyToDisplay(metric, p.value, unit) }));
  const latest = points.at(-1);
  const seed = latest ? bodyToDisplay(metric, latest.value, unit) : null;
  const current = entry[metric] ?? seed;
  const typedValue = Number.parseFloat(typed.replace(',', '.'));
  const toSave = current ?? (Number.isFinite(typedValue) ? typedValue : null);
  const delta = seriesDelta(shown);
  const u = bodyUnit(metric, unit);
  const isPlateau = metric === 'weight' && plateau(points, data.loadedAt);

  const step = (sign: 1 | -1) => {
    if (current === null) return;
    setEntry((prev) => ({ ...prev, [metric]: stepBody(current, sign * bodyStep(metric, unit), metric, unit) }));
  };

  const save = async () => {
    // Guards the Button disables, repeated here because the keyboard's Done key
    // calls save() directly and knows nothing about the Button's state.
    if (toSave === null || !clientId || saving || !offline.online) return;
    const input = {
      id: Crypto.randomUUID(),
      client_id: clientId,
      measured_at: new Date().toISOString(),
      note: null,
      ...metricPayload(metric, bodyToStored(metric, toSave, unit)),
    };
    if (!bodyMetricInputSchema.safeParse(input).success) {
      setSaveError(t('body.saveError'));
      return;
    }
    setSaving(true);
    setSaveError(null);
    const r = await recordBodyMetric(input);
    setSaving(false);
    if (r.error || !r.row) {
      setSaveError(t('body.saveError'));
      return;
    }
    data.applySaved(r.row);
    setEntry((prev) => ({ ...prev, [metric]: undefined }));
    setTyped('');
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { error } = await deleteBodyMetric(pendingDelete);
    if (error) setSaveError(t('body.saveError'));
    else data.applyDeleted(pendingDelete);
    setPendingDelete(null);
  };

  const canDelete = (recordedBy: string) => viewerIsClient || recordedBy === auth.user?.id;
  const primary = (PRIMARY_METRICS as readonly string[]).includes(metric);

  return (
    <Screen padded={false}>
      <NavHeader
        leading={
          <Button
            label={t('common.back')}
            variant="link"
            icon="chevronBack"
            onPress={() => clientId && backFromBody(clientId, origin)}
          />
        }
      />
      <ScrollView
        // Without this the first tap on Save only dismisses the keyboard, so saving a
        // typed first measurement took two taps.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: theme.space[6], gap: theme.space[4] }}
      >
        <View>
          <Text variant="h2">{t('body.title')}</Text>
          <Text variant="caption" tone="muted">
            {t('body.subtitle', { weeks })}
          </Text>
        </View>

        <SegmentedPill
          items={PRIMARY_METRICS.map((k) => ({ label: label(k), value: k }))}
          selected={primary ? metric : ''}
          onChange={(v) => setMetric(v as BodyMetricKey)}
        />
        <ChipRow
          options={MORE_METRICS.map(label)}
          selected={primary ? [] : [label(metric)]}
          onToggle={(opt) => {
            const hit = MORE_METRICS.find((k) => label(k) === opt);
            if (hit) setMetric(hit);
          }}
        />

        {data.loading ? <Skeleton height={180} radius={14} /> : null}
        {data.error ? <Banner variant="danger" message={t('body.loadError')} /> : null}

        {!data.loading && !data.error ? (
          points.length === 0 ? (
            <EmptyState icon="sliders" title={t('body.emptyTitle')} body={t('body.emptyBody')} />
          ) : (
            <>
              <Row style={{ alignItems: 'flex-end', gap: 10 }}>
                <Text variant="display" numeric style={{ fontSize: 40, lineHeight: 42 }}>
                  {formatBody(seed, metric, unit)}
                </Text>
                <Text variant="bodyBold" tone="muted" style={{ paddingBottom: 5 }}>
                  {u}
                </Text>
                <View style={{ flex: 1 }} />
                {delta !== null ? (
                  <Tag
                    numeric
                    tone={delta <= 0 ? 'success' : 'warn'}
                    label={`${delta > 0 ? '+' : ''}${formatBody(delta, metric, unit)} ${u}`}
                  />
                ) : null}
              </Row>
              {isPlateau ? <Tag tone="warn" label={t('body.plateau')} style={{ alignSelf: 'flex-start' }} /> : null}
              <TrendChart
                points={shown}
                startMs={data.loadedAt - weeks * WEEK}
                endMs={data.loadedAt}
                labels={weekLabels(weeks).map((n) => t('body.weekLabel', { n }))}
                accessibilityLabel={t('body.chartLabel', { metric: label(metric) })}
              />
              <ChipRow
                options={CHART_WINDOWS.map((w) => t('body.window', { weeks: w }))}
                selected={[t('body.window', { weeks })]}
                onToggle={(opt) => {
                  const w = CHART_WINDOWS.find((x) => t('body.window', { weeks: x }) === opt);
                  if (w) setWeeks(w);
                }}
              />
            </>
          )
        ) : null}

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('body.logToday')}</SectionLabel>
          {current !== null ? (
            <MeasureStepper
              value={formatBody(current, metric, unit)}
              unit={u}
              onDecrement={() => step(-1)}
              onIncrement={() => step(1)}
              decrementLabel={t('body.decrease')}
              incrementLabel={t('body.increase')}
            />
          ) : (
            // Nothing to step from yet: the first value is typed once — the unit is in
            // the label because there is no stepper yet to carry it, and the keyboard's
            // Done key saves so the first measurement is one gesture, not two.
            <TextField
              label={t('body.firstValue', { unit: u })}
              value={typed}
              onChangeText={setTyped}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={() => void save()}
            />
          )}
          {saveError ? <Banner variant="danger" message={saveError} /> : null}
          <Button
            label={offline.online ? t('body.save') : t('body.needsConnection')}
            size="lg"
            loading={saving}
            disabled={!offline.online || toSave === null || saving}
            onPress={() => void save()}
          />
        </View>

        <SectionCard>
          <ListRow
            leading={<Icon name="user" size={19} color={theme.colors.textMuted} />}
            title={t('body.photos.title')}
            onPress={() => clientId && router.push({ pathname: '/(app)/body/[clientId]/photos', params: { clientId } })}
            isLast
          />
        </SectionCard>

        {windowed.length > 0 ? (
          <View style={{ gap: theme.space[2] }}>
            <SectionLabel>{t('body.history')}</SectionLabel>
            {pendingDelete ? (
              <Card>
                <Text variant="bodyBold">{t('body.deleteTitle')}</Text>
                <Row style={{ gap: theme.space[2], marginTop: theme.space[3] }}>
                  <Button label={t('common.cancel')} variant="link" onPress={() => setPendingDelete(null)} />
                  <Button label={t('body.deleteConfirm')} variant="ghost" tone="danger" onPress={() => void confirmDelete()} />
                </Row>
              </Card>
            ) : null}
            <SectionCard>
              {historyRows(windowed).map(({ point, delta: d }, i, all) => (
                <Pressable
                  key={point.id}
                  onLongPress={canDelete(point.recordedBy) ? () => setPendingDelete(point.id) : undefined}
                  accessibilityHint={canDelete(point.recordedBy) ? t('body.deleteHint') : undefined}
                >
                  <ListRow
                    title={new Date(point.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    chevron={false}
                    isLast={i === all.length - 1}
                    trailing={
                      <Row style={{ gap: 10, alignItems: 'center' }}>
                        <Text variant="bodyBold" numeric>
                          {`${formatBody(bodyToDisplay(metric, point.value, unit), metric, unit)} ${u}`}
                        </Text>
                        <Text
                          variant="caption"
                          numeric
                          style={{
                            color:
                              d === null ? theme.colors.textMuted : d <= 0 ? theme.colors.successAccent : theme.colors.warnAccent,
                          }}
                        >
                          {d === null
                            ? '—'
                            : `${d > 0 ? '+' : ''}${formatBody(bodyToDisplay(metric, d, unit), metric, unit)}`}
                        </Text>
                      </Row>
                    }
                  />
                </Pressable>
              ))}
            </SectionCard>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

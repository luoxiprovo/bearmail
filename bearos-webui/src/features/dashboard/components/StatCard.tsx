/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Info } from 'lucide-react';
import { DynamicIcon } from '@/components/common/DynamicIcon';
import { LineChart, Line } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HelpTooltip } from '@/components/common/HelpTooltip';
import type { Card as CardSchema } from '../types/schema';
import type { Metric } from '../types/metrics';
import { cardValue, formatValue, sparklineData, computeDelta } from '../helpers';
import { useLiveMetricsStore } from '../stores/liveMetricsStore';
import { getChartColor } from '@/components/ui/chart';
import { formatPercent } from '@/lib/format';

function DeltaBadge({ pct, direction }: { pct: number; direction: 'up' | 'down' | 'neutral' }) {
  const { t } = useTranslation();
  const value = formatPercent(Math.abs(pct), Number.isInteger(pct) ? 0 : 1);
  const label =
    direction === 'up'
      ? t('dashboard.deltaUp', 'Up {{value}}', { value })
      : direction === 'down'
        ? t('dashboard.deltaDown', 'Down {{value}}', { value })
        : t('dashboard.deltaNone', 'No change');
  return (
    <Badge variant="secondary" className="text-xs font-normal text-muted-foreground">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {direction === 'up' ? `\u2191 ${value}` : direction === 'down' ? `\u2193 ${value}` : '\u2013'}
      </span>
    </Badge>
  );
}

interface StatCardProps {
  card: CardSchema;
  historySamples: Metric[];
  historyWindow: { from: Date; to: Date };
}

export function StatCard({ card, historySamples, historyWindow }: StatCardProps) {
  const liveSnapshot = useLiveMetricsStore((s) => s.snapshot);

  const value = useMemo(() => {
    if (card.source === 'live') {
      const liveSamples = card.metrics.map((id) => liveSnapshot.get(id)).filter((m): m is Metric => m !== undefined);
      return cardValue(card, liveSamples);
    }
    return cardValue(card, historySamples);
  }, [card, liveSnapshot, historySamples]);

  const formattedValue = formatValue(value, card.format);

  const { from, to } = historyWindow;

  const sparkline = useMemo(() => {
    if (card.source !== 'history' || !card.sparkline) return null;
    return sparklineData(card, historySamples, from, to).map((v, i) => ({
      v,
      i,
    }));
  }, [card, historySamples, from, to]);

  const delta = useMemo(() => {
    if (card.source !== 'history' || !card.delta) return null;
    return computeDelta(card, historySamples, from, to);
  }, [card, historySamples, from, to]);

  return (
    <Card role="group" aria-label={card.title}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <DynamicIcon name={card.icon} fallback={HelpCircle} className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{card.title}</span>
          {card.description && <HelpTooltip content={card.description} label={card.title} icon={Info} />}
        </div>

        <div data-slot="stat-value" className="mt-2 text-2xl font-bold">
          {formattedValue}
        </div>

        {(delta || sparkline) && (
          <div className="mt-1 flex items-center gap-2">
            {delta && <DeltaBadge pct={delta.pct} direction={delta.direction} />}
            {sparkline && (
              <LineChart width={64} height={32} data={sparkline}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke={getChartColor(0)}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Clock, FileText, Timer, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime, formatElapsed, formatNumber } from '@/lib/format';
import { traceDurationMs } from '../format';
import { useTraceLabels } from '../hooks/useTraceLabels';
import type { TraceEvent } from '../types';

function SummaryCard({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon aria-hidden="true" className="h-4 w-4" />
          {label}
        </div>
        <p className="mt-1 truncate text-lg font-semibold">{children}</p>
      </CardContent>
    </Card>
  );
}

export function TraceSummaryCards({ events }: { events: TraceEvent[] }) {
  const { t } = useTranslation();
  const labels = useTraceLabels();
  const first = events.at(0);
  const last = events.at(-1);
  const durationMs = first && last && events.length >= 2 ? traceDurationMs(first.timestamp, last.timestamp) : null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <SummaryCard icon={FileText} label={t('tracing.spanType', 'Span Type')}>
        {first ? labels.event(first.event).label : '-'}
      </SummaryCard>
      <SummaryCard icon={Clock} label={t('tracing.date', 'Date')}>
        {first ? formatDateTime(first.timestamp, 'medium') : '-'}
      </SummaryCard>
      <SummaryCard icon={Timer} label={t('tracing.duration', 'Duration')}>
        {durationMs !== null ? formatElapsed(durationMs) : '-'}
      </SummaryCard>
      <SummaryCard icon={Activity} label={t('tracing.events', 'Events')}>
        {formatNumber(events.length)}
      </SummaryCard>
    </div>
  );
}

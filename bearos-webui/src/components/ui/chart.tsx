/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import * as React from 'react';
import { Tooltip as RechartsTooltip } from 'recharts';
import type { TooltipPayload } from 'recharts/types/state/tooltipSlice';
import { cn } from '@/lib/utils';

export const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
] as const;

export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export function ChartContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('w-full', className)}>{children}</div>;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipPayload;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-background p-2 shadow-md">
      {label && <p className="mb-1 text-xs text-muted-foreground">{label}</p>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color ?? 'currentColor' }}
          />
          <span className="text-muted-foreground">{entry.name ?? ''}</span>
          <span className="ml-auto font-medium">
            {formatter && typeof entry.value === 'number' ? formatter(entry.value) : String(entry.value ?? '')}
          </span>
        </div>
      ))}
    </div>
  );
}

export { RechartsTooltip };

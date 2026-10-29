/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HelpTooltip } from '@/components/common/HelpTooltip';
import { getChartColor } from '@/components/ui/chart';
import { ChartTooltipContent } from '@/components/ui/chart';
import type { Chart as ChartSchema } from '../types/schema';
import type { Metric, Period } from '../types/metrics';
import { bucketTimestamps, bucketValues, getBucketCount, formatTimeTick, formatValue } from '../helpers';
import { ChartSizedContainer } from './ChartSizedContainer';

interface DashboardChartProps {
  chart: ChartSchema;
  historySamples: Metric[];
  historyWindow: { from: Date; to: Date };
  period: Period;
}

export function DashboardChart({ chart, historySamples, historyWindow, period }: DashboardChartProps) {
  const { from, to } = historyWindow;
  const bucketCount = getBucketCount(period);
  const valueFormat = chart.valueFormat ?? 'number';

  const data = useMemo(() => {
    const seriesValues = chart.series.map((series) => bucketValues(series, historySamples, from, to, bucketCount));
    const timestamps = bucketTimestamps(from, to, bucketCount);

    const points = timestamps.map((ts, i) => {
      const point: Record<string, unknown> = {
        time: ts.getTime(),
        timeLabel: formatTimeTick(ts, period),
      };
      chart.series.forEach((series, s) => {
        point[series.label] = seriesValues[s][i];
      });
      return point;
    });

    if (chart.stacked) {
      const lastSeen: Record<string, number> = {};
      for (const point of points) {
        for (const series of chart.series) {
          const v = point[series.label];
          if (typeof v === 'number') {
            lastSeen[series.label] = v;
          } else {
            point[series.label] = lastSeen[series.label] ?? 0;
          }
        }
      }
    }

    return points;
  }, [historySamples, from, to, bucketCount, chart.series, chart.stacked, period]);

  const tickFormatter = (value: number) => formatValue(value, valueFormat);

  const tooltipFormatter = (value: number) => formatValue(value, valueFormat);

  const renderChart = (chartWidth: number, chartHeight: number) => {
    const commonProps = {
      data,
      width: chartWidth,
      height: chartHeight,
      margin: { top: 5, right: 10, left: 10, bottom: 5 },
    };

    const seriesElements = chart.series.map((s, i) => {
      const color = getChartColor(i);
      const key = s.label;

      switch (chart.kind) {
        case 'line':
          return (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          );
        case 'area':
          return (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={color}
              fill={color}
              fillOpacity={0.3}
              strokeWidth={2}
              stackId={chart.stacked ? '1' : undefined}
              isAnimationActive={false}
              connectNulls
            />
          );
        case 'bar':
          return (
            <Bar
              key={key}
              dataKey={key}
              fill={color}
              stackId={chart.stacked ? '1' : undefined}
              isAnimationActive={false}
            />
          );
      }
    });

    const axes = (
      <>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="timeLabel"
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={tickFormatter}
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
          tickLine={false}
          axisLine={false}
          width={60}
        />
        <Tooltip
          content={({ active, payload, label }) => (
            <ChartTooltipContent
              active={active}
              payload={payload}
              label={label as string}
              formatter={tooltipFormatter}
            />
          )}
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px' }} />
      </>
    );

    switch (chart.kind) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            {axes}
            {seriesElements}
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart {...commonProps}>
            {axes}
            {seriesElements}
          </AreaChart>
        );
      case 'bar':
        return (
          <BarChart {...commonProps}>
            {axes}
            {seriesElements}
          </BarChart>
        );
    }
  };

  return (
    <Card role="figure" aria-label={chart.title}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{chart.title}</CardTitle>
          {chart.description && <HelpTooltip content={chart.description} label={chart.title} icon={Info} />}
        </div>
      </CardHeader>
      <CardContent>
        <ChartSizedContainer height={288}>{(width, height) => renderChart(width, height)}</ChartSizedContainer>
      </CardContent>
    </Card>
  );
}

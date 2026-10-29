/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

export type Dashboard = {
  id: string;
  label: string;
  cards?: Card[];
  charts?: Chart[];
};

export type Card = {
  title: string;
  icon: string;
  source: CardSource;
  metrics: string[];
  aggregate?: Aggregate;
  scope?: MetricScope;
  format: MetricFormat;
  description?: string;
  sparkline?: boolean;
  delta?: boolean;
};

export type Chart = {
  title: string;
  kind: ChartKind;
  series: Series[];
  stacked?: boolean;
  valueFormat?: MetricFormat;
  description?: string;
};

export type Series = {
  label: string;
  metrics: string[];
  aggregate?: Aggregate;
  scope?: MetricScope;
};

export type Aggregate = 'sum' | 'avg' | 'last';
export type MetricScope = 'node' | 'cluster';
export type ChartKind = 'line' | 'area' | 'bar';
export type CardSource = 'live' | 'history';
export type MetricFormat = 'number' | 'bytes' | 'duration' | 'percent';

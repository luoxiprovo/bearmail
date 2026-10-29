/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSchemaStore } from '@/stores/schemaStore';
import type { Dashboard } from '../types/schema';
import type { Metric } from '../types/metrics';
import { useDashboardStore } from '../stores/dashboardStore';
import { useLiveMetricsStore } from '../stores/liveMetricsStore';
import { useClusterNodes, useHistoryMetrics } from '../queries';
import { useCanAccess } from '@/hooks/usePermissions';
import { errorMessage } from '@/lib/jmapErrors';
import { collectHistoryMetricIds, collectLiveMetricIds, distinctNodeIds, nodeOptions, periodWindow } from '../helpers';
import { StatCard } from './StatCard';
import { DashboardChart } from './DashboardChart';
import { PeriodSelector } from './PeriodSelector';
import { NodeSelector } from './NodeSelector';

const EMPTY_METRICS: Metric[] = [];

interface DashboardViewProps {
  dashboardId: string;
  section: string;
}

export function DashboardView({ dashboardId, section }: DashboardViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const schema = useSchemaStore((s) => s.schema);
  const period = useDashboardStore((s) => s.period);
  const nodeId = useDashboardStore((s) => s.nodeId);
  const setNodeId = useDashboardStore((s) => s.setNodeId);
  const canReadNodes = useCanAccess('x:ClusterNode', 'Get');
  const subscribeLive = useLiveMetricsStore((s) => s.subscribe);
  const unsubscribeLive = useLiveMetricsStore((s) => s.unsubscribe);
  const liveStatus = useLiveMetricsStore((s) => s.status);
  const liveError = useLiveMetricsStore((s) => s.error);

  const dashboards = useMemo<Dashboard[]>(() => schema?.dashboards ?? [], [schema]);
  const dashboard = dashboards.find((d) => d.id === dashboardId);

  useEffect(() => {
    if (!dashboard && dashboards.length > 0) {
      navigate(`/${section}/Dashboard/${dashboards[0].id}`, { replace: true });
    }
  }, [dashboard, dashboards, navigate, section]);

  const historyIds = useMemo(
    () => (dashboard ? collectHistoryMetricIds(dashboard.cards, dashboard.charts) : new Set<string>()),
    [dashboard],
  );
  const liveIds = useMemo(() => (dashboard ? collectLiveMetricIds(dashboard.cards) : new Set<string>()), [dashboard]);

  const history = useHistoryMetrics(period, historyIds, nodeId);
  const allNodesHistory = useHistoryMetrics(period, historyIds, null, nodeId === null);
  const clusterNodes = useClusterNodes(canReadNodes);
  const historySamples = history.data?.metrics ?? EMPTY_METRICS;
  const historyWindow = history.data?.window ?? periodWindow(period);
  const nodes = nodeOptions(
    clusterNodes.data,
    distinctNodeIds(allNodesHistory.data?.metrics ?? historySamples),
    nodeId,
  );
  const showNodeSelector = nodes.length > 1 || nodeId !== null;

  useEffect(() => {
    if (liveIds.size > 0) {
      subscribeLive(liveIds);
    }
    return () => {
      unsubscribeLive();
    };
  }, [liveIds, subscribeLive, unsubscribeLive]);

  const isLoading = history.isFetching;
  const { refetch: refetchHistory } = history;

  const handleRefresh = useCallback(() => {
    if (historyIds.size > 0) void refetchHistory();
  }, [historyIds, refetchHistory]);

  if (!dashboard) {
    if (dashboards.length === 0) {
      return (
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          {t('dashboard.noDashboards', 'No dashboards configured.')}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {dashboards.length > 1 && (
          <Tabs
            className="min-w-0 max-w-full"
            value={dashboardId}
            onValueChange={(id) => navigate(`/${section}/Dashboard/${id}`)}
          >
            <TabsList className="max-w-full justify-start overflow-x-auto">
              {dashboards.map((d) => (
                <TabsTrigger key={d.id} value={d.id}>
                  {d.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {dashboards.length === 1 && <h1 className="text-xl font-semibold">{dashboard.label}</h1>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {showNodeSelector && <NodeSelector nodes={nodes} value={nodeId} onChange={setNodeId} />}
          <PeriodSelector onRefresh={handleRefresh} loading={isLoading} />
        </div>
      </div>

      {history.isError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          {errorMessage(history.error, t('dashboard.failedFetchMetrics', 'Failed to fetch metrics'))}
        </div>
      )}

      {liveStatus === 'error' && liveError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          {liveError}
        </div>
      )}

      {dashboard.cards && dashboard.cards.length > 0 && (
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
          {dashboard.cards.map((card, i) => (
            <StatCard
              key={`${card.title}-${i}`}
              card={card}
              historySamples={historySamples}
              historyWindow={historyWindow}
            />
          ))}
        </div>
      )}

      {dashboard.charts && dashboard.charts.length > 0 && (
        <div className="space-y-4">
          {dashboard.charts.map((chart, i) => (
            <DashboardChart
              key={`${chart.title}-${i}`}
              chart={chart}
              historySamples={historySamples}
              historyWindow={historyWindow}
              period={period}
            />
          ))}
        </div>
      )}
    </div>
  );
}

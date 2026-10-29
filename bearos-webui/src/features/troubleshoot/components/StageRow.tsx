/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { ChevronRight, CircleCheck, CircleX, Globe, Loader2, Mail, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { formatElapsed } from '@/lib/format';
import { phaseLabel, stageBody } from '../stageText';
import { stageSeverity, type DeliveryStage, type MX, type ReportUri, type StageSeverity } from '../types';

function SeverityIcon({ severity }: { severity: StageSeverity }) {
  const { t } = useTranslation();
  switch (severity) {
    case 'pending':
      return (
        <Loader2
          role="img"
          aria-label={t('deliveryTrace.severity.pending', 'In progress')}
          className="h-4 w-4 animate-spin text-muted-foreground"
        />
      );
    case 'ok':
      return (
        <CircleCheck
          role="img"
          aria-label={t('deliveryTrace.severity.ok', 'Succeeded')}
          className="h-4 w-4 text-emerald-500"
        />
      );
    case 'warn':
      return (
        <TriangleAlert
          role="img"
          aria-label={t('deliveryTrace.severity.warn', 'Warning')}
          className="h-4 w-4 text-amber-500"
        />
      );
    case 'error':
      return (
        <CircleX role="img" aria-label={t('deliveryTrace.severity.error', 'Failed')} className="h-4 w-4 text-red-500" />
      );
  }
}

function MxTable({ mxs }: { mxs: MX[] }) {
  const rows = [...mxs]
    .sort((a, b) => a.preference - b.preference)
    .flatMap((mx) => mx.exchanges.map((exchange) => ({ preference: mx.preference, exchange })));
  return (
    <div className="mt-1 rounded border text-xs">
      {rows.map(({ preference, exchange }) => (
        <div key={`${preference}-${exchange}`} className="flex gap-3 border-b px-3 py-1 last:border-b-0">
          <span className="w-8 text-right text-muted-foreground">{preference}</span>
          <span>{exchange}</span>
        </div>
      ))}
    </div>
  );
}

function ReportUris({ rua }: { rua: ReportUri[] }) {
  return (
    <ul className="mt-1 space-y-1">
      {rua.map((uri) => {
        const value = uri.type === 'mail' ? uri.email : uri.url;
        const Icon = uri.type === 'mail' ? Mail : Globe;
        return (
          <li key={`${uri.type}:${value}`} className="flex items-center gap-2 text-xs">
            <Icon aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
            <span>{value}</span>
          </li>
        );
      })}
    </ul>
  );
}

function OpaqueObject({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="mt-1 rounded border bg-muted/30 p-2">
      <dl className="space-y-1 text-xs">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="min-w-24 font-medium text-muted-foreground">{k}</dt>
            <dd className="break-all">
              {typeof v === 'object' && v !== null ? (
                <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(v, null, 2)}</pre>
              ) : (
                String(v)
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StageDetails({ stage }: { stage: DeliveryStage }) {
  switch (stage.type) {
    case 'mxLookupSuccess':
      return <MxTable mxs={stage.mxs} />;
    case 'mtaStsFetchSuccess':
      return <OpaqueObject data={stage.policy} />;
    case 'tlsRptLookupSuccess':
      return <ReportUris rua={stage.rua} />;
    case 'tlsaLookupSuccess':
      return <OpaqueObject data={stage.record} />;
    default:
      return null;
  }
}

function hasDetails(stage: DeliveryStage): boolean {
  return (
    stage.type === 'mxLookupSuccess' ||
    stage.type === 'mtaStsFetchSuccess' ||
    stage.type === 'tlsRptLookupSuccess' ||
    stage.type === 'tlsaLookupSuccess'
  );
}

export function StageRow({ stage }: { stage: DeliveryStage }) {
  const { t } = useTranslation();
  const severity = stageSeverity(stage);
  const body = stageBody(t, stage);
  const elapsed = 'elapsed' in stage ? stage.elapsed : null;

  const content = (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 shrink-0">
        <SeverityIcon severity={severity} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{phaseLabel(t, stage)}</span>
          {elapsed !== null && (
            <Badge variant="secondary" className="text-xs">
              {formatElapsed(elapsed)}
            </Badge>
          )}
        </div>
        {body && (
          <p className={cn('mt-0.5 text-xs', severity === 'error' ? 'text-red-500' : 'text-muted-foreground')}>
            {body}
          </p>
        )}
      </div>
    </div>
  );

  if (!hasDetails(stage)) return content;

  return (
    <Collapsible>
      {content}
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group ml-7 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight aria-hidden="true" className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
          {t('deliveryTrace.viewDetails', 'View details')}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-7">
        <StageDetails stage={stage} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { isStreamActive, type StreamStatus } from '@/services/sse';
import { MAX_LIVE_EVENTS, type TraceBuffer } from '../liveTracing';
import { TraceTimeline } from './TraceTimeline';

interface LiveTracingSessionProps {
  status: StreamStatus;
  buffer: TraceBuffer;
  error: string | null;
  onStop: () => void;
  onRestart: () => void;
}

function StreamIndicator({ status }: { status: StreamStatus }) {
  const { t } = useTranslation();
  if (status.kind === 'open') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {t('tracing.streamingEvents', 'Streaming events...')}
      </div>
    );
  }
  if (status.kind === 'reconnecting' || status.kind === 'connecting') {
    return <span className="text-sm text-muted-foreground">{t('tracing.reconnecting', 'Reconnecting...')}</span>;
  }
  if (status.kind === 'closed') {
    return <span className="text-sm text-muted-foreground">{t('tracing.stopped', 'Stopped')}</span>;
  }
  return null;
}

export function LiveTracingSession({ status, buffer, error, onStop, onRestart }: LiveTracingSessionProps) {
  const { t } = useTranslation();
  const active = isStreamActive(status);
  const count = buffer.events.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{t('tracing.liveTitle', 'Live Tracing')}</h1>
          <div role="status">
            <StreamIndicator status={status} />
          </div>
        </div>
        {active ? (
          <Button variant="outline" onClick={onStop}>
            <Square aria-hidden="true" className="mr-2 h-4 w-4" />
            {t('tracing.stopTracing', 'Stop tracing')}
          </Button>
        ) : (
          <Button variant="outline" onClick={onRestart}>
            <RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />
            {t('tracing.restart', 'Restart')}
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <TraceTimeline
            events={buffer.events}
            anchorTimestamp={buffer.anchorTimestamp ?? undefined}
            keyOffset={buffer.dropped}
          />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        {t('tracing.eventCount', '{{count}} events', { count })}
        {count >= MAX_LIVE_EVENTS && ' ' + t('tracing.bufferFull', '(buffer full)')}
      </p>
    </div>
  );
}

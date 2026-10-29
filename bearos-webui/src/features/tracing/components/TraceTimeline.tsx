/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDot, CircleX, Clock } from 'lucide-react';
import { formatElapsed, formatTime } from '@/lib/format';
import { traceEventKind } from '../format';
import { useTraceLabels } from '../hooks/useTraceLabels';
import type { TraceEvent } from '../types';
import { TraceKeyValueList } from './TraceValue';

const STICKY_BOTTOM_PX = 50;

interface TraceTimelineProps {
  events: TraceEvent[];
  anchorTimestamp?: string;
  keyOffset?: number;
}

export function TraceTimeline({ events, anchorTimestamp, keyOffset = 0 }: TraceTimelineProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastKey = keyOffset + events.length;

  useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastKey]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_BOTTOM_PX;
  };

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        {t('tracing.noEvents', 'No trace events to display.')}
      </div>
    );
  }

  const anchorMs = new Date(anchorTimestamp ?? events[0].timestamp).getTime();

  return (
    <div className="relative">
      <div ref={containerRef} onScroll={handleScroll} className="max-h-[70vh] overflow-y-auto scroll-smooth">
        <ol className="space-y-4 p-2">
          {events.map((event, idx) => (
            <TraceEventItem key={keyOffset + idx} event={event} anchorMs={anchorMs} />
          ))}
        </ol>
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
    </div>
  );
}

function TraceEventIcon({ eventType }: { eventType: string }) {
  switch (traceEventKind(eventType)) {
    case 'error':
      return <CircleX aria-hidden="true" className="h-4 w-4 text-red-500" />;
    case 'span':
      return <Clock aria-hidden="true" className="h-4 w-4 text-muted-foreground" />;
    default:
      return <CircleDot aria-hidden="true" className="h-4 w-4 text-muted-foreground" />;
  }
}

function TraceEventItem({ event, anchorMs }: { event: TraceEvent; anchorMs: number }) {
  const labels = useTraceLabels();
  const { label, explanation, known } = labels.event(event.event);
  const offset = new Date(event.timestamp).getTime() - anchorMs;

  return (
    <li className="flex gap-3">
      <div className="mt-1 shrink-0">
        <TraceEventIcon eventType={event.event} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            {known ? (
              <span className="text-sm font-semibold">{label}</span>
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{label}</span>
            )}
            {explanation && <p className="mt-0.5 text-xs text-muted-foreground">{explanation}</p>}
          </div>
          <div className="shrink-0 text-right text-xs">
            <time dateTime={event.timestamp} className="block text-muted-foreground">
              {formatTime(event.timestamp, { milliseconds: true })}
            </time>
            <div className="text-muted-foreground/60">(+{formatElapsed(offset)})</div>
          </div>
        </div>
        {event.keyValues.length > 0 && (
          <div className="mt-2 space-y-1">
            <TraceKeyValueList keyValues={event.keyValues} />
          </div>
        )}
      </div>
    </li>
  );
}

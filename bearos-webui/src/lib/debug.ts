/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

const isDev = import.meta.env.DEV;

function isEnabled(envVar: string | undefined): boolean {
  if (!isDev || !envVar) return false;
  const v = envVar.toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
}

export const debugJmap = isEnabled(import.meta.env.VITE_DEBUG_JMAP);
export const debugForms = isEnabled(import.meta.env.VITE_DEBUG_FORMS);

type JmapCall = [string, Record<string, unknown>, string];

function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof args.accountId === 'string') {
    parts.push(`account=${truncate(args.accountId, 12)}`);
  }
  if (Array.isArray(args.ids)) {
    parts.push(`ids=${args.ids.length}`);
  } else if (args.ids === null) {
    parts.push('ids=all');
  }
  if (args.create && typeof args.create === 'object') {
    parts.push(`create=${Object.keys(args.create).length}`);
  }
  if (args.update && typeof args.update === 'object') {
    parts.push(`update=${Object.keys(args.update).length}`);
  }
  if (Array.isArray(args.destroy)) {
    parts.push(`destroy=${args.destroy.length}`);
  }
  if (Array.isArray(args.list)) {
    parts.push(`list=${args.list.length}`);
  }
  if (typeof args.total === 'number') {
    parts.push(`total=${args.total}`);
  }
  return parts.join(' ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildSummaryRows(calls: unknown): Array<Record<string, string>> {
  if (!Array.isArray(calls)) return [];
  return calls.map((call, idx) => {
    if (!Array.isArray(call) || call.length < 3) {
      return { '#': String(idx), method: '?', callId: '?', summary: '' };
    }
    const [method, args, callId] = call as JmapCall;
    return {
      '#': String(idx),
      method,
      callId,
      summary: args && typeof args === 'object' ? summarizeArgs(args) : '',
    };
  });
}

export function logJmapExchange(methodCalls: unknown, methodResponses: unknown, durationMs?: number): void {
  if (!debugJmap) return;

  const hasError = Array.isArray(methodResponses) && methodResponses.some((r) => Array.isArray(r) && r[0] === 'error');

  const methodNames = Array.isArray(methodCalls)
    ? methodCalls.map((c) => (Array.isArray(c) && typeof c[0] === 'string' ? c[0] : '?')).join(' · ')
    : '?';

  const durationLabel = typeof durationMs === 'number' ? ` (${Math.round(durationMs)}ms)` : '';

  const headerColor = hasError ? '#dc2626' : '#2563eb';

  console.groupCollapsed(
    `%c[JMAP]%c ${methodNames}${durationLabel}${hasError ? ' (with errors)' : ''}`,
    `color: ${headerColor}; font-weight: bold`,
    'color: inherit',
  );

  console.groupCollapsed('%c→ request', 'color: #2563eb; font-weight: bold');
  console.table(buildSummaryRows(methodCalls));
  console.log(JSON.stringify(methodCalls, null, 2));
  console.groupEnd();

  console.groupCollapsed(
    `%c← response${hasError ? ' (with errors)' : ''}`,
    `color: ${hasError ? '#dc2626' : '#16a34a'}; font-weight: bold`,
  );
  console.table(buildSummaryRows(methodResponses));
  console.log(JSON.stringify(methodResponses, null, 2));
  console.groupEnd();

  console.groupEnd();
}

export function logFormChange(label: string, data: unknown): void {
  if (!debugForms) return;
  console.groupCollapsed(`%c[Form]%c ${label}`, 'color: #9333ea; font-weight: bold', 'color: inherit');
  console.log(JSON.stringify(data, null, 2));
  console.groupEnd();
}

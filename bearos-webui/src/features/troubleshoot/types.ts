/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

export type DeliveryStage =
  | { type: 'mxLookupStart'; domain: string }
  | { type: 'mxLookupSuccess'; mxs: MX[]; elapsed: number }
  | { type: 'mxLookupError'; reason: string; elapsed: number }
  | { type: 'mtaStsFetchStart' }
  | { type: 'mtaStsFetchSuccess'; policy: Policy; elapsed: number }
  | { type: 'mtaStsFetchError'; reason: string; elapsed: number }
  | { type: 'mtaStsNotFound'; elapsed: number }
  | { type: 'tlsRptLookupStart' }
  | { type: 'tlsRptLookupSuccess'; rua: ReportUri[]; elapsed: number }
  | { type: 'tlsRptLookupError'; reason: string; elapsed: number }
  | { type: 'tlsRptNotFound'; elapsed: number }
  | { type: 'deliveryAttemptStart'; hostname: string }
  | { type: 'mtaStsVerifySuccess' }
  | { type: 'mtaStsVerifyError'; reason: string }
  | { type: 'tlsaLookupStart' }
  | { type: 'tlsaLookupSuccess'; record: Tlsa; elapsed: number }
  | { type: 'tlsaNotFound'; elapsed: number; reason: string }
  | { type: 'tlsaLookupError'; elapsed: number; reason: string }
  | { type: 'ipLookupStart' }
  | { type: 'ipLookupSuccess'; remoteIps: string[]; elapsed: number }
  | { type: 'ipLookupError'; reason: string; elapsed: number }
  | { type: 'connectionStart'; remoteIp: string }
  | { type: 'connectionSuccess'; elapsed: number }
  | { type: 'connectionError'; elapsed: number; reason: string }
  | { type: 'readGreetingStart' }
  | { type: 'readGreetingSuccess'; elapsed: number }
  | { type: 'readGreetingError'; elapsed: number; reason: string }
  | { type: 'ehloStart' }
  | { type: 'ehloSuccess'; elapsed: number }
  | { type: 'ehloError'; elapsed: number; reason: string }
  | { type: 'startTlsStart' }
  | { type: 'startTlsSuccess'; elapsed: number }
  | { type: 'startTlsError'; elapsed: number; reason: string }
  | { type: 'daneVerifySuccess' }
  | { type: 'daneVerifyError'; reason: string }
  | { type: 'mailFromStart' }
  | { type: 'mailFromSuccess'; elapsed: number }
  | { type: 'mailFromError'; reason: string; elapsed: number }
  | { type: 'rcptToStart' }
  | { type: 'rcptToSuccess'; elapsed: number }
  | { type: 'rcptToError'; reason: string; elapsed: number }
  | { type: 'quitStart' }
  | { type: 'quitCompleted'; elapsed: number }
  | { type: 'completed' };

export interface MX {
  exchanges: string[];
  preference: number;
}

export type ReportUri = { type: 'mail'; email: string } | { type: 'http'; url: string };

export type Policy = Record<string, unknown>;
export type Tlsa = Record<string, unknown>;

export type StageSeverity = 'pending' | 'ok' | 'warn' | 'error';

export function stageSeverity(stage: DeliveryStage): StageSeverity {
  const t = stage.type;
  if (t === 'completed') return 'ok';
  if (t === 'deliveryAttemptStart') return 'ok';
  if (t.endsWith('Error')) return 'error';
  if (t.endsWith('NotFound')) return 'warn';
  if (t.endsWith('Start')) return 'pending';
  return 'ok';
}

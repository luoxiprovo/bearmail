/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

export interface JmapRequest {
  using: string[];
  methodCalls: JmapMethodCall[];
}

export type JmapMethodCall = [string, Record<string, unknown>, string];

export interface JmapResponse {
  methodResponses: JmapMethodResponse[];
  sessionState?: string;
}

export type JmapMethodResponse = [string, Record<string, unknown>, string];

export interface JmapGetResponse {
  accountId: string;
  state: string;
  list: Record<string, unknown>[];
  notFound: string[];
}

export interface JmapQueryResponse {
  accountId: string;
  queryState: string;
  canCalculateChanges: boolean;
  position: number;
  ids: string[];
  total?: number;
  limit?: number;
}

export interface JmapSetResponse {
  accountId: string;
  oldState: string;
  newState: string;
  created: Record<string, Record<string, unknown>> | null;
  notCreated: Record<string, JmapSetError> | null;
  updated: Record<string, null | Record<string, unknown>> | null;
  notUpdated: Record<string, JmapSetError> | null;
  destroyed: string[] | null;
  notDestroyed: Record<string, JmapSetError> | null;
}

export interface JmapSetError {
  type: string;
  description?: string;
  properties?: string[];
  existingId?: string;
  objectId?: string;
  linkedObjects?: string[];
  validationErrors?: ValidationError[];
}

export interface ValidationError {
  type: 'Invalid' | 'Required' | 'MaxLength' | 'MinLength' | 'MaxValue' | 'MinValue';
  property: string;
  value?: string;
  required?: number;
}

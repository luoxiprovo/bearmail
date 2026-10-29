/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

export const SECRET_MASK = '****';

export function jmapMapToArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === 'object') {
    return Object.entries(val as Record<string, T>)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v);
  }
  return [];
}

/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

let cached: string | undefined;

export function getBasePath(): string {
  if (cached !== undefined) return cached;

  const base = document.querySelector('base')?.getAttribute('href') ?? '/';
  cached = base.replace(/\/+$/, '');
  return cached;
}

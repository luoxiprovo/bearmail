/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getLogoState, loadLogoOnce, subscribeToLogo } from '@/lib/logoCache';

export function DefaultLogo() {
  const { t } = useTranslation();
  return (
    <span aria-label={t('logo.alt', 'BearOS')} className="text-2xl font-semibold tracking-tight">
      BearOS
    </span>
  );
}

export default function Logo() {
  const { t } = useTranslation();
  const logo = useSyncExternalStore(subscribeToLogo, getLogoState, getLogoState);

  useEffect(() => {
    loadLogoOnce();
  }, []);

  if (logo.status === 'custom') {
    return <img src={logo.url} alt={t('logo.alt', 'Logo')} className="h-7 w-auto max-w-[220px] object-contain" />;
  }

  if (logo.status === 'loading') {
    return <span className="block h-7 w-[140px]" aria-hidden="true" />;
  }

  return <DefaultLogo />;
}

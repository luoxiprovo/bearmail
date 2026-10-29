/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CopyButton } from '@/components/common/CopyButton';
import { DefaultLogo } from '@/components/common/Logo';
import type { Fields } from '@/types/schema';

export function WizardShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-content-background">
      <header className="flex items-center px-6 py-4 border-b bg-background">
        <DefaultLogo />
      </header>
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}

export function ProgressIndicator({ total, current }: { total: number; current: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-2"
      aria-label={t('bootstrap.stepOf', 'Step {{current}} of {{total}}', { current: current + 1, total })}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 w-2 rounded-full transition-colors ${
            i < current ? 'bg-primary' : i === current ? 'bg-primary' : 'bg-muted-foreground/20'
          }`}
        />
      ))}
    </div>
  );
}

export function SuccessScreen({
  extras,
  fields,
  labelsByName,
}: {
  extras: Record<string, unknown>;
  fields: Fields;
  labelsByName: Map<string, string>;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(extras).filter(([k, v]) => {
    if (k === 'id' || k === 'blobId' || k === '@type') return false;
    return typeof v === 'string' && v.length > 0;
  }) as [string, string][];

  const hasCredentials = entries.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Check className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{t('bootstrap.complete', 'Setup complete')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {hasCredentials
              ? t(
                  'bootstrap.credentialsCreated',
                  'Your administrator account has been created. Write these down now: the password will not be shown again.',
                )
              : t('bootstrap.configuredSuccessfully', 'BearOS has been configured successfully.')}
          </p>
        </div>
      </div>

      {hasCredentials && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {entries.map(([key, value]) => {
              const field = fields.properties[key];
              const label = labelsByName.get(key) ?? field?.description?.split('\n')[0] ?? key;
              return (
                <div key={key} className="space-y-1.5">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="flex gap-2">
                    <code className="flex-1 rounded bg-muted p-2 text-sm break-all select-all">{value}</code>
                    <CopyButton value={value} label={label} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
        <p className="text-sm">
          <span className="font-medium">{t('bootstrap.nextStepLabel', 'Next step:')}</span>{' '}
          {t(
            'bootstrap.nextStepBody',
            'restart BearOS for the new configuration to take effect. Once restarted, sign in with the credentials above to continue administering your server.',
          )}
        </p>
      </div>
    </div>
  );
}

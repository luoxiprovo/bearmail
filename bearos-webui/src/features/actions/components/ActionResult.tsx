/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DynamicView } from '@/components/views/DynamicView';
import type { ObjectVariant, Schema } from '@/types/schema';

interface ActionResultProps {
  schema: Schema;
  variant: ObjectVariant;
  data: Record<string, unknown>;
  onNewAction: () => void;
}

export function ActionResult({ schema, variant, data, onNewAction }: ActionResultProps) {
  const { t } = useTranslation();
  const hasData = !!variant.schemaName && Object.keys(data).length > 0;

  return (
    <div className="space-y-6 pt-4">
      <div role="status" className="flex items-center gap-3">
        <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0 text-emerald-500" />
        <div>
          <h1 className="font-medium">{variant.label}</h1>
          <p className="text-sm text-muted-foreground">
            {t('actions.executedSuccess', 'Action executed successfully.')}
          </p>
        </div>
      </div>

      {hasData && variant.schemaName ? (
        <DynamicView
          schema={schema}
          objectName={variant.schemaName}
          viewName={variant.schemaName}
          data={data}
          visibleFields={new Set(Object.keys(data))}
        />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t('actions.noAdditionalData', 'No additional data returned.')}
          </CardContent>
        </Card>
      )}

      <Button onClick={onNewAction}>
        <Zap aria-hidden="true" className="mr-2 h-4 w-4" />
        {t('actions.executeAnother', 'Execute another action')}
      </Button>
    </div>
  );
}

export function ActionError({ error, onBack }: { error: string; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl space-y-4 pt-8">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div role="alert" className="flex items-center gap-3">
            <CircleAlert aria-hidden="true" className="h-5 w-5 shrink-0 text-destructive" />
            <div>
              <h1 className="font-medium">{t('actions.failedTitle', 'Action failed')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
          <Button variant="outline" onClick={onBack}>
            {t('actions.backToActions', 'Back to actions')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

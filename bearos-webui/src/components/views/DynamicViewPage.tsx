/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSchemaStore } from '@/stores/schemaStore';
import { resolveObject, resolveList, getDisplayProperty } from '@/lib/schemaResolver';
import { coerceLabel } from '@/lib/objectOptions';
import { errorMessage } from '@/lib/jmapErrors';
import { useJmapObject } from '@/data/objects';
import { DynamicView } from './DynamicView';

interface DynamicViewPageProps {
  viewName: string;
  objectId: string;
}

export function DynamicViewPage({ viewName, objectId }: DynamicViewPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const schema = useSchemaStore((s) => s.schema);
  const resolvedObject = schema ? resolveObject(schema, viewName) : null;
  const query = useJmapObject(resolvedObject?.objectName, objectId);
  const data = query.data ?? null;
  const loading = query.isPending && query.fetchStatus !== 'idle';
  const error = !schema
    ? null
    : !resolvedObject
      ? t('view.couldNotResolve', 'Could not resolve object')
      : query.isError
        ? errorMessage(query.error, t('view.failedToLoad', 'Failed to load'))
        : query.isSuccess && !data
          ? t('view.objectNotFound', 'Object not found')
          : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data || !schema) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('common.back', 'Back')}
        </Button>
        <div className="text-destructive p-4">{error ?? t('view.failedToLoad', 'Failed to load')}</div>
      </div>
    );
  }

  const resolved = resolveObject(schema, viewName);
  if (!resolved) return null;

  const list = resolveList(schema, viewName, resolved.objectName);
  const labelProp = getDisplayProperty(schema, viewName);
  const rawLabel = labelProp ? coerceLabel(data[labelProp], '') : '';
  const displayName = rawLabel.length > 0 ? rawLabel : undefined;
  const singularName = list?.singularName ?? resolved.objectName.replace(/^x:/, '');
  const title = displayName
    ? `${singularName.charAt(0).toUpperCase() + singularName.slice(1)}: ${displayName}`
    : singularName.charAt(0).toUpperCase() + singularName.slice(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('common.back', 'Back')}
        </Button>
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>

      <DynamicView schema={schema} objectName={resolved.objectName} viewName={viewName} data={data} />
    </div>
  );
}

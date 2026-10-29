/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useCanAccess } from '@/hooks/usePermissions';
import { coerceLabel } from '@/lib/objectOptions';
import { TENANT_PROPERTY } from '@/lib/schemaResolver';
import { CreatedValuesDialog } from '@/components/forms/CreatedValuesDialog';
import { FormProvider } from '@/components/forms/FormProvider';
import { FormSections } from '@/components/forms/FormSections';
import { UnsavedChangesDialog } from '@/components/forms/UnsavedChangesDialog';
import { formFieldLabels } from '@/components/forms/formLogic';
import { useDynamicForm, type DynamicFormModel } from '@/components/forms/useDynamicForm';

interface DynamicFormProps {
  viewName: string;
  objectId: string | null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function useFormTitle(model: DynamicFormModel): string {
  const { t } = useTranslation();
  const { resolved, mode, isSingleton, state, parentForm, variantForm } = model;
  if (!resolved) return '';
  const titleForm = parentForm ?? variantForm;
  if (isSingleton) return titleForm?.title ?? resolved.object.objectType.description;
  const name = resolved.list?.singularName ?? resolved.object.objectType.description;
  if (mode === 'create') return t('form.createTitle', 'Create {{name}}', { name });
  const labelProperty = resolved.list?.labelProperty;
  const value = labelProperty ? coerceLabel(state.data[labelProperty], '') : '';
  return value
    ? t('form.editTitleWithValue', 'Edit {{name}}: {{value}}', { name, value })
    : t('form.editTitle', 'Edit {{name}}', { name });
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center p-12 text-muted-foreground" role="status">
      <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

export function DynamicForm({ viewName, objectId }: DynamicFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canUpdate = useCanAccess(viewName, 'Update');
  const canDestroy = useCanAccess(viewName, 'Destroy');
  const model = useDynamicForm(viewName, objectId);
  const { schema, resolved, mode, isSingleton, state, isDirty, saving, loading, loadError } = model;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const title = useFormTitle(model);

  if (!schema || !resolved) return <Loading label={t('form.loadingSchema', 'Loading schema...')} />;
  if (loading) return <Loading label={t('form.loadingData', 'Loading data...')} />;

  const isCreate = mode === 'create';
  const readOnly = !isCreate && !canUpdate;
  const canDelete = !isCreate && !isSingleton && canDestroy;
  const subtitle = (model.parentForm ?? model.variantForm)?.subtitle;
  const errorText = state.generalError ?? loadError;
  const header = (
    <div className="flex items-center gap-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => navigate(-1)}
        aria-label={t('common.back', 'Back')}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Button>
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );

  if (model.loadFailed) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {header}
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4" role="alert">
          <p className="whitespace-pre-line text-sm text-destructive">{loadError}</p>
        </div>
        <Button type="button" variant="outline" onClick={model.retryLoad}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('common.retry', 'Retry')}
        </Button>
      </div>
    );
  }
  const deleteLabel = (
    resolved.list?.singularName ??
    resolved.object.objectType.description ??
    t('form.item', 'item')
  ).toLowerCase();
  const sch = resolved.resolvedSchema;
  const tenantValue = state.data[TENANT_PROPERTY];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {header}

      {errorText && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4" role="alert">
          <p className="whitespace-pre-line text-sm text-destructive">{errorText}</p>
        </div>
      )}

      <FormProvider
        schema={schema}
        mode={mode}
        readOnly={readOnly}
        recordLabel={model.recordLabel}
        baseline={state.original}
        tenantId={typeof tenantValue === 'string' ? tenantValue : null}
      >
        <FormSections
          sections={model.sections}
          data={state.data}
          errors={state.fieldErrors}
          readOnly={readOnly}
          onFieldChange={model.setField}
          variant={
            sch.type === 'multiple'
              ? { variants: sch.variants, value: state.variant, onChange: model.setVariant }
              : undefined
          }
        />
      </FormProvider>

      <div className="flex items-center justify-between pb-8 pt-2">
        <div>
          {canDelete && (
            <Button type="button" variant="destructive" disabled={saving} onClick={() => setDeleteConfirmOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('common.delete', 'Delete')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-xs text-muted-foreground">{t('form.unsavedChangesLabel', 'Unsaved changes')}</span>
          )}
          <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          {!readOnly && (
            <Button type="button" onClick={() => void model.save()} disabled={saving || (!isCreate && !isDirty)}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {isCreate ? t('common.create', 'Create') : t('common.save', 'Save')}
            </Button>
          )}
        </div>
      </div>

      <UnsavedChangesDialog blocker={model.guard.blocker} />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        variant="destructive"
        title={t('form.deleteTitle', 'Delete {{name}}?', { name: capitalize(deleteLabel) })}
        description={t(
          'form.deleteDescription',
          'This action cannot be undone. This will permanently delete this {{name}}.',
          { name: deleteLabel },
        )}
        confirmLabel={t('common.delete', 'Delete')}
        onConfirm={model.remove}
      />

      <CreatedValuesDialog
        values={state.created?.values ?? null}
        labels={formFieldLabels(model.parentForm, model.variantForm)}
        onContinue={model.continueAfterCreate}
      />
    </div>
  );
}

export default DynamicForm;

/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldScopeProvider } from '@/components/forms/FormProvider';
import { useFormContext } from '@/components/forms/formContext';
import { FieldControl } from '@/components/forms/widgets/FieldControl';
import { buildNewObjectValue } from '@/lib/schemaResolver';
import { isRecord } from '@/lib/embeddedSchema';
import type { WidgetProps } from '@/components/forms/widgets/types';
import type { Field, FieldTypeObject, FieldTypeObjectList } from '@/types/schema';

export function ObjectListWidget({
  type,
  field,
  formField,
  value,
  onChange,
  readOnly,
}: WidgetProps<FieldTypeObjectList>) {
  const { t } = useTranslation();
  const { schema } = useFormContext();
  const itemType: FieldTypeObject = { type: 'object', objectName: type.objectName };
  const itemField: Field = { description: '', type: itemType, update: field.update, enterprise: field.enterprise };
  const items = isRecord(value) ? value : {};
  const entries = Object.entries(items).sort(([a], [b]) => Number(a) - Number(b));
  const canRemove = type.minItems == null || entries.length > type.minItems;
  const canAdd = type.maxItems == null || entries.length < type.maxItems;

  const addItem = () => {
    const next = entries.length > 0 ? Math.max(...entries.map(([k]) => Number(k) || 0)) + 1 : 0;
    onChange({ ...items, [String(next)]: buildNewObjectValue(schema, type.objectName) });
  };

  const removeItem = (key: string) => {
    const copy = { ...items };
    delete copy[key];
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      {entries.map(([key, item], position) => {
        const itemLabel = t('field.itemN', '{{label}} {{n}}', { label: formField.label, n: position + 1 });
        return (
          <div key={key} className="space-y-3 rounded-md border p-4">
            {!readOnly && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => removeItem(key)}
                  disabled={!canRemove}
                  aria-label={t('field.removeItemN', 'Remove item {{n}}', { n: position + 1 })}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}
            <FieldScopeProvider name={key} readOnly={readOnly}>
              <FieldControl
                type={itemType}
                field={itemField}
                formField={{ name: key, label: itemLabel }}
                value={item}
                onChange={(v) => onChange({ ...items, [key]: v })}
                readOnly={readOnly}
                control={{ 'aria-label': itemLabel }}
              />
            </FieldScopeProvider>
          </div>
        );
      })}
      {!readOnly && canAdd && (
        <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('field.addItem', 'Add item')}
        </Button>
      )}
    </div>
  );
}

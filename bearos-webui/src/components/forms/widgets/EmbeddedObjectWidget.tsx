/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldRow } from '@/components/forms/FieldRow';
import { VariantSelect } from '@/components/forms/VariantSelect';
import { useFormContext } from '@/components/forms/formContext';
import { buildEmbeddedDefaults } from '@/lib/schemaResolver';
import { embeddedEntries, isRecord, resolveEmbedded, switchVariantValues } from '@/lib/embeddedSchema';
import type { ControlProps, WidgetProps } from '@/components/forms/widgets/types';
import type { FieldTypeObject } from '@/types/schema';

interface EmbeddedObjectEditorProps {
  objectName: string;
  control?: ControlProps;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
}

function EmbeddedObjectEditor({ objectName, control, value, onChange, readOnly }: EmbeddedObjectEditorProps) {
  const { t } = useTranslation();
  const { schema, mode, baseline } = useFormContext();
  const [initial, setInitial] = useState({ baseline, value });
  if (initial.baseline !== baseline) setInitial({ baseline, value });
  const resolved = resolveEmbedded(schema, objectName, value);

  if (!resolved) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('field.unknownObjectType', 'Unknown object type: {{name}}', { name: objectName })}
      </p>
    );
  }

  const obj = isRecord(value) ? value : {};
  const changeVariant = (next: string) => {
    const defaults = buildEmbeddedDefaults(schema, objectName, {}, next);
    const target = resolveEmbedded(schema, objectName, defaults);
    const original = mode === 'edit' ? initial.value : undefined;
    onChange(switchVariantValues(resolved.fields, target?.fields, value, defaults, original));
  };
  const entries = embeddedEntries(resolved).filter(({ field }) => field.update !== 'serverSet');

  return (
    <div className="space-y-4 rounded-md border p-4">
      {resolved.variants && (
        <VariantSelect
          labelledBy={control?.['aria-labelledby']}
          ariaLabel={control?.['aria-label']}
          variants={resolved.variants}
          value={resolved.variant?.name ?? ''}
          onChange={changeVariant}
          readOnly={readOnly}
        />
      )}
      {entries.map(({ formField, field }) => (
        <FieldRow
          key={formField.name}
          field={field}
          formField={formField}
          value={obj[formField.name]}
          onChange={(v) => onChange({ ...obj, [formField.name]: v })}
        />
      ))}
    </div>
  );
}

export function EmbeddedObjectWidget({ type, value, onChange, readOnly, control }: WidgetProps<FieldTypeObject>) {
  return (
    <EmbeddedObjectEditor
      objectName={type.objectName}
      control={control}
      value={value}
      onChange={onChange}
      readOnly={readOnly}
    />
  );
}

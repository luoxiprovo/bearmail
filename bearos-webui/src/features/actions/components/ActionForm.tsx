/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldRow } from '@/components/forms/FieldRow';
import { FormProvider } from '@/components/forms/FormProvider';
import { resolveVariantForm } from '@/lib/schemaResolver';
import type { ObjectVariant, Schema } from '@/types/schema';
import { editableSections, missingRequiredFields } from '../actionModel';

interface ActionFormProps {
  schema: Schema;
  variant: ObjectVariant & { schemaName: string };
  initialData: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void;
  onBack: () => void;
}

export function ActionForm({ schema, variant, initialData, onSubmit, onBack }: ActionFormProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fields = schema.fields[variant.schemaName];
  const form = resolveVariantForm(schema, '', '', variant.schemaName);
  if (!fields || !form) return null;
  const sections = editableSections(form.sections, fields);

  const handleChange = (name: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleSubmit = () => {
    const missing = missingRequiredFields(sections, fields, formData);
    if (missing.length > 0) {
      const required = t('form.required', 'This field is required.');
      setErrors(Object.fromEntries(missing.map((name) => [name, required])));
      return;
    }
    onSubmit(formData);
  };

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {t('common.back', 'Back')}
        </Button>
        <h1 className="text-xl font-semibold">{variant.label}</h1>
      </div>

      <FormProvider schema={schema} mode="create">
        {sections.map((section) => (
          <Card key={section.fields.map((f) => f.name).join('|')}>
            {section.title && (
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{section.title}</CardTitle>
              </CardHeader>
            )}
            <CardContent className={section.title ? 'pt-0' : undefined}>
              <div className="space-y-4">
                {section.fields.map((ff) => {
                  const def = fields.properties[ff.name];
                  if (!def) return null;
                  return (
                    <FieldRow
                      key={ff.name}
                      formField={ff}
                      field={def}
                      value={formData[ff.name]}
                      onChange={(v) => handleChange(ff.name, v)}
                      error={errors[ff.name]}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </FormProvider>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit">
          <Zap aria-hidden="true" className="mr-2 h-4 w-4" />
          {t('actions.execute', 'Execute')}
        </Button>
      </div>
    </form>
  );
}

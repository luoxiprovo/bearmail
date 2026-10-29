/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldRow } from '@/components/forms/FieldRow';
import { VariantSelect } from '@/components/forms/VariantSelect';
import type { EmbeddedVariant } from '@/lib/embeddedSchema';
import type { FieldErrors, FieldValues, RenderableSection } from '@/components/forms/formLogic';
import { useIsCommunity } from '@/hooks/usePermissions';

interface VariantControl {
  variants: readonly EmbeddedVariant[];
  value: string;
  onChange: (variant: string) => void;
}

interface FormSectionsProps {
  sections: RenderableSection[];
  data: FieldValues;
  errors: FieldErrors;
  readOnly: boolean;
  onFieldChange: (name: string, value: unknown) => void;
  variant?: VariantControl;
}

export function FormSections({ sections, data, errors, readOnly, onFieldChange, variant }: FormSectionsProps) {
  const isCommunity = useIsCommunity();
  return (
    <>
      {sections.map((section) => {
        const fields = section.fields.filter(({ field }) => !(isCommunity && field?.enterprise));
        if (fields.length === 0) return null;
        return (
          <FormSectionCard key={section.key} title={section.title}>
            {fields.map(({ formField, field }) => {
              if (!field) {
                if (!variant) return null;
                return (
                  <VariantSelect
                    key={formField.name}
                    label={formField.label}
                    variants={variant.variants}
                    value={variant.value}
                    onChange={variant.onChange}
                    readOnly={readOnly}
                  />
                );
              }
              return (
                <FieldRow
                  key={formField.name}
                  field={field}
                  formField={formField}
                  value={data[formField.name]}
                  onChange={(v) => onFieldChange(formField.name, v)}
                  error={errors[formField.name]}
                />
              );
            })}
          </FormSectionCard>
        );
      })}
    </>
  );
}

export function FormSectionCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card>
      {title && (
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={title ? '' : 'pt-6'}>
        <div className="space-y-6">{children}</div>
      </CardContent>
    </Card>
  );
}

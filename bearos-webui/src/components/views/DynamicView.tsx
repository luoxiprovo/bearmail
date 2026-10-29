/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ValueRow } from '@/components/values/FieldValue';
import { resolveForm, resolveSchema, resolveVariantForm } from '@/lib/schemaResolver';
import { isEmptyValue, variantLabel } from '@/lib/embeddedSchema';
import type { Field, Fields, Form, FormField, Schema } from '@/types/schema';

export interface DynamicViewProps {
  schema: Schema;
  objectName: string;
  viewName: string;
  data: Record<string, unknown>;
  visibleFields?: Set<string>;
}

interface ViewSection {
  key: string;
  title?: string;
  items: { formField: FormField; field: Field }[];
}

function resolveViewLayout(
  schema: Schema,
  objectName: string,
  viewName: string,
  data: Record<string, unknown>,
): { fields: Fields | null; form: Form | null } | null {
  const sch = resolveSchema(schema, objectName);
  if (!sch) return null;
  if (sch.type === 'single') {
    return { fields: sch.fields, form: resolveForm(schema, viewName, objectName, sch.schemaName) };
  }
  const variant = sch.variants.find((v) => v.name === data['@type']);
  const fields = variant?.fields ?? null;
  const variantForm = variant?.schemaName ? resolveVariantForm(schema, viewName, objectName, variant.schemaName) : null;
  const parentForm = resolveForm(schema, viewName, objectName, objectName);
  const sections = [...(parentForm?.sections ?? []), ...(variantForm?.sections ?? [])];
  return { fields, form: sections.length > 0 ? { ...(variantForm ?? parentForm), sections } : null };
}

function buildViewSections(
  layout: { fields: Fields | null; form: Form | null },
  data: Record<string, unknown>,
  visibleFields?: Set<string>,
): ViewSection[] {
  const { fields, form } = layout;
  const include = (name: string) =>
    name !== '@type' && (!visibleFields || visibleFields.has(name)) && !isEmptyValue(data[name]);
  if (form) {
    return form.sections
      .map((section, index) => ({
        key: `section-${index}`,
        title: section.title,
        items: section.fields.flatMap((formField) => {
          const field = fields?.properties[formField.name];
          return field && include(formField.name) ? [{ formField, field }] : [];
        }),
      }))
      .filter((section) => section.items.length > 0);
  }
  const items = Object.entries(fields?.properties ?? {})
    .filter(([name]) => include(name))
    .map(([name, field]) => ({ formField: { name, label: name }, field }));
  return items.length > 0 ? [{ key: 'section-0', items }] : [];
}

export function DynamicView({ schema, objectName, viewName, data, visibleFields }: DynamicViewProps) {
  const layout = resolveViewLayout(schema, objectName, viewName, data);
  if (!layout) return null;
  const sections = buildViewSections(layout, data, visibleFields);
  const typeLabel = variantLabel(schema, objectName, data['@type']);

  return (
    <div className="space-y-4">
      {typeLabel && (
        <Badge variant="secondary" className="text-xs">
          {typeLabel}
        </Badge>
      )}
      {sections.map((section) => (
        <Card key={section.key}>
          {section.title && (
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
          )}
          <CardContent className={section.title ? 'pt-0' : ''}>
            <dl className="space-y-2">
              {section.items.map(({ formField, field }) => (
                <ValueRow
                  key={formField.name}
                  schema={schema}
                  label={formField.label}
                  description={field.description}
                  type={field.type}
                  value={data[formField.name]}
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

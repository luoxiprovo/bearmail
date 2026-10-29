/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldLabel } from '@/components/forms/FieldRow';
import { fieldIds, useFieldScope, useFormContext } from '@/components/forms/formContext';
import { VARIANT_FIELD } from '@/components/forms/formLogic';
import type { EmbeddedVariant } from '@/lib/embeddedSchema';

interface VariantSelectProps {
  label?: string;
  labelledBy?: string;
  ariaLabel?: string;
  variants: readonly EmbeddedVariant[];
  value: string;
  onChange: (variant: string) => void;
  readOnly: boolean;
}

export function VariantSelect({
  label,
  labelledBy,
  ariaLabel,
  variants,
  value,
  onChange,
  readOnly,
}: VariantSelectProps) {
  const { t } = useTranslation();
  const ctx = useFormContext();
  const scope = useFieldScope();
  const ids = fieldIds(ctx.idPrefix, [...scope.path, VARIANT_FIELD]);
  const external = !!labelledBy || !!ariaLabel;
  return (
    <div className="space-y-1.5">
      {!external && (
        <FieldLabel
          id={ids.labelId}
          htmlFor={ids.inputId}
          label={label || t('field.type', 'Type')}
          marker={null}
          locked={false}
        />
      )}
      <Select value={value} onValueChange={onChange} disabled={readOnly}>
        <SelectTrigger id={ids.inputId} className="w-full" aria-labelledby={labelledBy} aria-label={ariaLabel}>
          <SelectValue placeholder={t('form.selectType', 'Select type...')} />
        </SelectTrigger>
        <SelectContent>
          {variants.map((v) => (
            <SelectItem key={v.name} value={v.name}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

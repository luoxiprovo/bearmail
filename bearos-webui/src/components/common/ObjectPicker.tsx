/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ObjectSearchPopover } from '@/components/common/ObjectSearchPopover';
import { useNoPermissionMessage } from '@/lib/objectOptions';
import { useObjectOptions, useDisplayName } from '@/data/objectOptions';
import type { Schema } from '@/types/schema';

interface ObjectPickerProps {
  schema: Schema;
  objectName: string;
  label: string;
  value: string;
  onChange: (id: string) => void;
  onClear?: () => void;
  placeholder?: string;
}

export function ObjectPicker({ schema, objectName, label, value, onChange, onClear, placeholder }: ObjectPickerProps) {
  const { t } = useTranslation();
  const list = useObjectOptions(objectName, schema);
  const fromList = list.options.find((o) => o.id === value)?.label;
  const { label: cheapLabel, loading: labelLoading } = useDisplayName(
    objectName,
    fromList ? null : value || null,
    schema,
  );
  const display = fromList ?? cheapLabel;
  const noPermissionMessage = useNoPermissionMessage(schema, objectName);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {value && (
        <Badge variant="secondary" className="gap-1 pr-1.5 text-sm max-w-xs">
          {labelLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <span className="truncate" title={display ?? value}>
              {display ?? value}
            </span>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
              aria-label={t('field.clearValue', 'Clear {{name}}', { name: label })}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      )}
      {!value && placeholder && <span className="text-sm text-muted-foreground">{placeholder}</span>}
      <ObjectSearchPopover
        label={t('field.chooseValue', 'Choose {{name}}', { name: label })}
        options={list.options}
        loading={list.loading}
        error={list.error}
        ensureLoaded={list.ensureLoaded}
        onSelect={onChange}
        disabledMessage={noPermissionMessage}
      />
    </div>
  );
}

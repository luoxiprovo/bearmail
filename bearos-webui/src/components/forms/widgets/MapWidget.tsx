/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ObjectSearchPopover } from '@/components/common/ObjectSearchPopover';
import { FieldScopeProvider } from '@/components/forms/FormProvider';
import { useFormContext } from '@/components/forms/formContext';
import { FieldControl } from '@/components/forms/widgets/FieldControl';
import { formatPlaceholder } from '@/components/forms/widgets/placeholders';
import { useNoPermissionMessage } from '@/lib/objectOptions';
import { useDisplayName, useObjectOptions } from '@/data/objectOptions';
import { buildNewObjectValue, getEnum, getEnumVariant } from '@/lib/schemaResolver';
import { isRecord } from '@/lib/embeddedSchema';
import type { WidgetProps } from '@/components/forms/widgets/types';
import type { Field, FieldType, FieldTypeMap, MapValueType, ScalarType } from '@/types/schema';

function defaultMapValue(valueClass: MapValueType, newObject: (objectName: string) => unknown): unknown {
  switch (valueClass.type) {
    case 'number':
      return 0;
    case 'object':
      return newObject(valueClass.objectName);
    default:
      return '';
  }
}

export function MapWidget({ type, formField, value, onChange, readOnly }: WidgetProps<FieldTypeMap>) {
  const { t } = useTranslation();
  const { schema } = useFormContext();
  const map = isRecord(value) ? value : {};
  const entries = Object.entries(map);
  const [newKey, setNewKey] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const canAdd = type.maxItems == null || entries.length < type.maxItems;
  const canRemove = type.minItems == null || entries.length > type.minItems;
  const trimmedKey = newKey.trim();
  const valueField: Field = { description: '', type: type.valueClass as FieldType, update: 'mutable' };

  const setOpen = (key: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  const addEntry = () => {
    if (!trimmedKey || Object.hasOwn(map, trimmedKey) || !canAdd) return;
    onChange({
      ...map,
      [trimmedKey]: defaultMapValue(type.valueClass, (name) => buildNewObjectValue(schema, name)),
    });
    setOpen(trimmedKey, true);
    setNewKey('');
  };

  const removeEntry = (key: string) => {
    const copy = { ...map };
    delete copy[key];
    onChange(copy);
    setOpen(key, false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry();
    }
  };

  return (
    <div className="space-y-3">
      {entries.map(([key, val]) => (
        <Collapsible key={key} open={expanded.has(key)} onOpenChange={(open) => setOpen(key, open)}>
          <div className="rounded-md border">
            <div className="flex items-center">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 rounded-t-md p-3 text-sm font-medium transition-colors hover:bg-accent/50 [&[data-state=open]>svg]:rotate-90"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" aria-hidden="true" />
                  <MapKeyLabel keyClass={type.keyClass} keyValue={key} />
                </button>
              </CollapsibleTrigger>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mr-2 h-7 w-7 shrink-0"
                  onClick={() => removeEntry(key)}
                  disabled={!canRemove}
                  aria-label={t('field.removeEntry', 'Remove entry {{name}}', { name: key })}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-1">
                <FieldScopeProvider name={key} readOnly={readOnly}>
                  <FieldControl
                    type={valueField.type}
                    field={valueField}
                    formField={{ name: key, label: formField.valueLabel ?? '' }}
                    value={val}
                    onChange={(v) => onChange({ ...map, [key]: v })}
                    readOnly={readOnly}
                    control={{ 'aria-label': formField.valueLabel ?? key }}
                  />
                </FieldScopeProvider>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
      {!readOnly && canAdd && (
        <div className="flex items-center gap-2">
          <MapKeyInput
            keyClass={type.keyClass}
            label={formField.keyLabel ?? t('field.newKey', 'New key')}
            value={newKey}
            onChange={setNewKey}
            onKeyDown={handleKeyDown}
            existingKeys={map}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addEntry}
            disabled={!trimmedKey || Object.hasOwn(map, trimmedKey)}
            className="shrink-0 gap-1"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('field.add', 'Add')}
          </Button>
        </div>
      )}
    </div>
  );
}

function MapKeyLabel({ keyClass, keyValue }: { keyClass: ScalarType; keyValue: string }) {
  const { schema } = useFormContext();
  if (keyClass.type === 'enum') return <>{getEnumVariant(schema, keyClass.enumName, keyValue)?.label ?? keyValue}</>;
  if (keyClass.type === 'objectId') return <ObjectIdKeyLabel objectName={keyClass.objectName} id={keyValue} />;
  return <>{keyValue}</>;
}

function ObjectIdKeyLabel({ objectName, id }: { objectName: string; id: string }) {
  const { schema } = useFormContext();
  const { label, loading } = useDisplayName(objectName, id, schema);
  if (loading && !label) return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />;
  return <>{label ?? id}</>;
}

interface MapKeyInputProps {
  keyClass: ScalarType;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  existingKeys: Record<string, unknown>;
}

function MapKeyInput({ keyClass, label, value, onChange, onKeyDown, existingKeys }: MapKeyInputProps) {
  const { t } = useTranslation();
  const { schema } = useFormContext();
  switch (keyClass.type) {
    case 'enum': {
      const variants = getEnum(schema, keyClass.enumName).filter((v) => !Object.hasOwn(existingKeys, v.name));
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="flex-1" aria-label={label}>
            <SelectValue placeholder={t('field.selectKey', 'Select key...')} />
          </SelectTrigger>
          <SelectContent>
            {variants.map((v) => (
              <SelectItem key={v.name} value={v.name}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case 'objectId':
      return (
        <MapKeyObjectIdInput
          objectName={keyClass.objectName}
          label={label}
          value={value}
          onChange={onChange}
          existingKeys={existingKeys}
        />
      );
    default:
      return (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          placeholder={
            (keyClass.type === 'string' ? formatPlaceholder(keyClass.format) : undefined) ?? t('field.key', 'Key...')
          }
          className="flex-1"
        />
      );
  }
}

function MapKeyObjectIdInput({
  objectName,
  label,
  value,
  onChange,
  existingKeys,
}: {
  objectName: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  existingKeys: Record<string, unknown>;
}) {
  const { schema, tenantId } = useFormContext();
  const list = useObjectOptions(objectName, schema, tenantId);
  const noPermissionMessage = useNoPermissionMessage(schema, objectName);
  return (
    <div className="flex flex-1 items-center gap-2">
      {value && (
        <span className="text-sm">
          <ObjectIdKeyLabel objectName={objectName} id={value} />
        </span>
      )}
      <ObjectSearchPopover
        label={label}
        options={list.options.filter((o) => !Object.hasOwn(existingKeys, o.id))}
        loading={list.loading}
        error={list.error}
        ensureLoaded={list.ensureLoaded}
        onSelect={onChange}
        disabledMessage={noPermissionMessage}
      />
    </div>
  );
}

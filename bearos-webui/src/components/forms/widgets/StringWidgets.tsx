/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { useResetOnChange } from '@/hooks/useBufferedValue';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SECRET_MASK } from '@/lib/jmapUtils';
import { cn } from '@/lib/utils';
import { BufferedInput, BufferedTextarea } from '@/components/forms/widgets/BufferedInputs';
import { formatPlaceholder, inputTypeFor } from '@/components/forms/widgets/placeholders';
import type { WidgetProps } from '@/components/forms/widgets/types';
import type { FieldTypeString } from '@/types/schema';

function stringCommitter({ type, onChange }: WidgetProps<FieldTypeString>) {
  return (v: string) => onChange(type.nullable && v === '' ? null : v);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function TextWidget(props: WidgetProps<FieldTypeString>) {
  const { type, formField, value, readOnly, control } = props;
  const commit = stringCommitter(props);
  return (
    <BufferedInput
      {...control}
      type={inputTypeFor(type.format)}
      value={stringValue(value)}
      onCommit={commit}
      disabled={readOnly}
      placeholder={formField.placeholder ?? formatPlaceholder(type.format)}
      minLength={type.minLength}
      maxLength={type.maxLength}
    />
  );
}

export function MultilineWidget(props: WidgetProps<FieldTypeString>) {
  const { type, formField, value, readOnly, control } = props;
  const commit = stringCommitter(props);
  const common = {
    ...control,
    value: stringValue(value),
    onCommit: commit,
    disabled: readOnly,
    placeholder: formField.placeholder,
    minLength: type.minLength,
    maxLength: type.maxLength,
  };

  if (type.format === 'html') {
    return (
      <div className="rounded-md border bg-muted/30">
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="font-mono">HTML</span>
        </div>
        <BufferedTextarea
          {...common}
          rows={10}
          spellCheck={false}
          className="resize-y rounded-none rounded-b-md border-0 bg-transparent font-mono text-xs focus-visible:ring-0"
        />
      </div>
    );
  }
  if (type.format === 'sieve') {
    return <BufferedTextarea {...common} rows={16} spellCheck={false} className="font-mono text-xs" />;
  }
  return <BufferedTextarea {...common} rows={4} />;
}

export function ColorWidget(props: WidgetProps<FieldTypeString>) {
  const { t } = useTranslation();
  const { value, readOnly, control } = props;
  const commit = stringCommitter(props);
  const str = stringValue(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={str || '#000000'}
        onChange={(e) => commit(e.target.value)}
        disabled={readOnly}
        aria-label={t('field.colorPicker', 'Color picker')}
        className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent p-1"
      />
      <BufferedInput
        {...control}
        value={str}
        onCommit={commit}
        disabled={readOnly}
        placeholder="#000000"
        className="max-w-[10rem]"
      />
    </div>
  );
}

export function SecretWidget(props: WidgetProps<FieldTypeString>) {
  const { t } = useTranslation();
  const { type, formField, value, readOnly, control } = props;
  const commitValue = stringCommitter(props);
  const strValue = stringValue(value);
  const multiline = type.format === 'secretText';

  const [visible, setVisible] = useState(false);
  const [localValue, setLocalValue] = useState(() => (strValue === SECRET_MASK ? '' : strValue));
  const [isMasked, setIsMasked] = useState(() => strValue === SECRET_MASK);

  useResetOnChange(strValue, () => {
    setLocalValue(strValue === SECRET_MASK ? '' : strValue);
    setIsMasked(strValue === SECRET_MASK);
  });

  const handleLocalChange = (v: string) => {
    setLocalValue(v);
    setIsMasked(false);
  };

  const commit = () => {
    if (isMasked && localValue === '') return;
    if (localValue !== strValue) commitValue(localValue);
  };

  const displayValue = isMasked && !visible ? '' : localValue;
  const placeholder = isMasked ? SECRET_MASK : formField.placeholder;
  const managerIgnore = { 'data-1p-ignore': true, 'data-lpignore': 'true', 'data-bwignore': true };

  const toggle = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => setVisible((p) => !p)}
      aria-label={visible ? t('field.hideValue', 'Hide value') : t('field.showValue', 'Show value')}
      aria-pressed={visible}
      tabIndex={-1}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  );

  if (multiline) {
    return (
      <div className="relative">
        <Textarea
          {...control}
          {...managerIgnore}
          value={displayValue}
          onChange={(e) => handleLocalChange(e.target.value)}
          onBlur={commit}
          disabled={readOnly}
          placeholder={placeholder}
          minLength={type.minLength}
          maxLength={type.maxLength}
          rows={4}
          autoComplete="off"
          className={cn(!visible && 'tracking-widest')}
          style={visible ? undefined : ({ WebkitTextSecurity: 'disc' } as CSSProperties)}
        />
        <div className="absolute right-1 top-1">{toggle}</div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        {...control}
        {...managerIgnore}
        type={visible ? 'text' : 'password'}
        value={displayValue}
        onChange={(e) => handleLocalChange(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        disabled={readOnly}
        placeholder={placeholder}
        minLength={type.minLength}
        maxLength={type.maxLength}
        autoComplete="off"
        className="flex-1"
      />
      {toggle}
    </div>
  );
}

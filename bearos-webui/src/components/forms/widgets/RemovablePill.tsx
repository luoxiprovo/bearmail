/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface RemovablePillProps {
  label: string;
  onRemove?: () => void;
  removeDisabled?: boolean;
  children?: ReactNode;
}

export function RemovablePill({ label, onRemove, removeDisabled, children }: RemovablePillProps) {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary" className="gap-1 pr-1 text-sm">
      {children ?? label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={t('field.removeItem', 'Remove {{name}}', { name: label })}
          className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </Badge>
  );
}

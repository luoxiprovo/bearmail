/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MassAction } from '@/types/schema';

export type RunnableMassAction = Exclude<MassAction, { type: 'separator' }>;

interface MassActionBarProps {
  actions: { key: string; action: MassAction }[];
  count: number;
  disabled: boolean;
  onSelect: (action: RunnableMassAction) => void;
}

export function MassActionBar({ actions, count, disabled, onSelect }: MassActionBarProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {t('list.massActionCount', 'Actions ({{count}})', { count })}
          <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map(({ key, action }) =>
          action.type === 'separator' ? (
            <DropdownMenuSeparator key={key} />
          ) : (
            <DropdownMenuItem
              key={key}
              className={action.type === 'delete' ? 'text-destructive' : undefined}
              onSelect={() => onSelect(action)}
            >
              {action.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

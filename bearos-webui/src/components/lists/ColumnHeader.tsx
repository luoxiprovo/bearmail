/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';

import type { Column } from '@/types/schema';
import type { ListSort } from './listUrlState';

interface ColumnHeaderProps {
  column: Column;
  sortable: boolean;
  sort: ListSort | null;
  onSort: (field: string) => void;
}

export function ColumnHeader({ column, sortable, sort, onSort }: ColumnHeaderProps) {
  const { t } = useTranslation();
  const direction = sort?.field === column.name ? (sort.ascending ? 'ascending' : 'descending') : 'none';
  const className = 'px-3 py-3 text-left font-medium text-muted-foreground';

  if (!sortable) {
    return (
      <th scope="col" className={className}>
        {column.label}
      </th>
    );
  }

  const hint =
    direction === 'none'
      ? t('list.sortAscending', 'Sort ascending')
      : direction === 'ascending'
        ? t('list.sortDescending', 'Sort descending')
        : t('list.sortClear', 'Clear sort');

  return (
    <th scope="col" aria-sort={direction} className={className}>
      <button
        type="button"
        onClick={() => onSort(column.name)}
        title={hint}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {column.label}
        {direction === 'ascending' ? (
          <ChevronUp className="h-4 w-4" aria-hidden />
        ) : direction === 'descending' ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : (
          <ArrowUpDown className="h-3 w-3" aria-hidden />
        )}
      </button>
    </th>
  );
}

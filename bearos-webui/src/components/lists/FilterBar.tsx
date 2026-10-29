/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Filter as FilterIcon, RotateCcw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Filter, Schema } from '@/types/schema';
import { filtersKey } from './listUrlState';
import { FilterField } from './FilterFields';

interface FilterBarProps {
  schema: Schema;
  filters: Filter[];
  applied: Record<string, string>;
  isXPrefixed: boolean;
  disabled: boolean;
  onApply: (values: Record<string, string>) => void;
  onReset: () => void;
}

export function FilterBar({ schema, filters, applied, isXPrefixed, disabled, onApply, onReset }: FilterBarProps) {
  const { t } = useTranslation();
  const panelId = useId();
  const appliedKey = filtersKey(applied);
  const [open, setOpen] = useState(() => Object.keys(applied).length > 0);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [draftKey, setDraftKey] = useState(appliedKey);
  if (draftKey !== appliedKey) {
    setDraftKey(appliedKey);
    setDraft(null);
  }
  const values = draft ?? applied;

  const setValue = (field: string, value: string) => setDraft({ ...values, [field]: value });

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDraft(null);
    onApply(values);
  };

  const handleReset = () => {
    setDraft(null);
    onReset();
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-controls={panelId}>
          <FilterIcon className="h-4 w-4" aria-hidden />
          {t('list.filters', 'Filters')}
          {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent id={panelId}>
        <form
          role="search"
          aria-label={t('list.filters', 'Filters')}
          onSubmit={handleSubmit}
          className="mt-2 rounded-lg border bg-background shadow-sm"
        >
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {filters.map((filter) => (
              <FilterField
                key={filter.field}
                schema={schema}
                filter={filter}
                values={values}
                isXPrefixed={isXPrefixed}
                onChange={setValue}
                onCommit={(field, value) => onApply({ ...applied, [field]: value })}
              />
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={handleReset} disabled={disabled}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              {t('list.resetFilters', 'Reset')}
            </Button>
            <Button type="submit" size="sm" disabled={disabled}>
              <Search className="mr-2 h-4 w-4" aria-hidden />
              {t('list.searchFilters', 'Search')}
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

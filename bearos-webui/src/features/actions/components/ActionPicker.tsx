/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useId } from 'react';
import { ChevronRight, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ObjectVariant } from '@/types/schema';
import type { ActionGroup } from '../actionModel';

interface ActionPickerProps {
  title: string;
  subtitle?: string;
  groups: ActionGroup[];
  disabled: boolean;
  onPick: (variant: ObjectVariant) => void;
}

function ActionGroupSection({
  group,
  disabled,
  onPick,
}: { group: ActionGroup } & Pick<ActionPickerProps, 'disabled' | 'onPick'>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-sm font-medium text-muted-foreground">
        {group.label}
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {group.actions.map(({ variant, name }) => (
          <Button
            key={variant.name}
            variant="outline"
            className="h-auto justify-between px-4 py-3"
            disabled={disabled}
            onClick={() => onPick(variant)}
          >
            <span className="flex items-center gap-2">
              <Zap aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{name}</span>
            </span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          </Button>
        ))}
      </div>
    </section>
  );
}

export function ActionPicker({ title, subtitle, groups, disabled, onPick }: ActionPickerProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="space-y-6">
        {groups.map((group) => (
          <ActionGroupSection key={group.label} group={group} disabled={disabled} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

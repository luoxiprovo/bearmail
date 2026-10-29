/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

export function Toaster() {
  const { toasts } = useToast();

  const visibleToasts = toasts.filter((t) => t.open !== false);

  return (
    <ToastViewport>
      {visibleToasts.map(function ({ id, title, description, variant, open, onOpenChange, ...props }) {
        return (
          <Toast key={id} variant={variant} open={open} onOpenChange={onOpenChange} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            <ToastClose onClick={() => onOpenChange?.(false)} />
          </Toast>
        );
      })}
    </ToastViewport>
  );
}

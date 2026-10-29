/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface EnterpriseUpsellProps {
  open: boolean;
  onClose: () => void;
}

export function EnterpriseUpsell({ open, onClose }: EnterpriseUpsellProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="gap-6">
        <DialogHeader className="space-y-4">
          <DialogTitle>{t('enterprise.trialTitle')}</DialogTitle>
          <DialogDescription>{t('enterprise.trialDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:items-center">
          <a
            href="https://stalw.art/compare#why-isnt-feature-x-open-source"
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline sm:mr-auto sm:text-left"
          >
            {t('enterprise.whyNotFree')}
          </a>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button asChild>
            <a href="https://license.stalw.art/trial" target="_blank" rel="noopener noreferrer">
              {t('enterprise.trialButton')}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

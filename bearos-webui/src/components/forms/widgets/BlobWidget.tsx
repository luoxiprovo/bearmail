/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBlobText } from '@/data/objects';
import { errorMessage } from '@/lib/jmapErrors';
import { BufferedTextarea } from '@/components/forms/widgets/BufferedInputs';
import type { WidgetProps } from '@/components/forms/widgets/types';
import type { FieldTypeBlobId } from '@/types/schema';

export function BlobWidget({ value, onChange, readOnly, control }: WidgetProps<FieldTypeBlobId>) {
  const { t } = useTranslation();
  const [edited, setEdited] = useState<string | null>(null);
  if (edited !== null && value !== edited) {
    setEdited(null);
  }
  const isOwnEdit = edited !== null && value === edited;
  const blobId = !isOwnEdit && typeof value === 'string' && value.length > 0 ? value : null;
  const blob = useBlobText(blobId);

  if (blobId && blob.isPending) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('field.loadingContent', 'Loading content...')}
      </div>
    );
  }

  if (blobId && (blob.isError || blob.data === null)) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
        <p className="text-sm text-destructive" role="alert">
          {blob.isError
            ? errorMessage(blob.error, t('field.blobLoadFailed', 'Failed to load content.'))
            : t('field.blobNotFound', 'The stored content could not be found.')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void blob.refetch()}
          disabled={blob.isFetching}
        >
          {t('common.retry', 'Retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <BufferedTextarea
        {...control}
        value={edited ?? blob.data ?? ''}
        onCommit={(text) => {
          setEdited(text);
          onChange(text);
        }}
        disabled={readOnly}
        rows={8}
        className="font-mono text-xs"
      />
      {isOwnEdit && (
        <p className="text-xs text-muted-foreground">
          {t('field.contentModified', 'Content modified (will be saved as a new blob)')}
        </p>
      )}
    </div>
  );
}

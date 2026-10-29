/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: LicenseRef-SEL
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function ChartSizedContainer({
  height,
  children,
}: {
  height: number;
  children: (width: number, height: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    const w = el.getBoundingClientRect().width;
    if (w > 0) setWidth(w);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && children(width, height)}
    </div>
  );
}

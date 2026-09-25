'use client';
import type { ReactNode } from 'react';
import { Overlay } from '@/components/ui/kit';

/**
 * Pay's drawer is the kit's `Overlay`.
 *
 * It was a second implementation of the same thing until the kit existed, and
 * the two had already drifted — this one shipped see-through because it
 * portalled to bare `<body>` without the `.skosx` wrapper every token is
 * scoped to. Kept as a named re-export so Pay's call sites read as Pay's, and
 * so there is exactly one overlay to fix if any of this is ever wrong again.
 */
export function Drawer({ title, subtitle, onClose, footer, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Overlay title={title} subtitle={subtitle} onClose={onClose} footer={footer}>
      {children}
    </Overlay>
  );
}

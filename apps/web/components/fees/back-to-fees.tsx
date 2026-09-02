import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/**
 * The way back out of a fee sub-page.
 *
 * Every fee screen below /app/fees is reached from the Fees home, but the
 * sidebar only highlights "Fees" — so once you were on Setup or the verify
 * desk there was no visible way back short of the browser button. Sits above
 * the page heading, where a reader looks first.
 */
export function BackToFees({ label = 'Fees' }: { label?: string }) {
  return (
    <Link
      href="/app/fees"
      className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold"
      style={{ color: 'var(--sk-ink-3)' }}
    >
      <ChevronLeft size={14} aria-hidden="true" />
      {label}
    </Link>
  );
}

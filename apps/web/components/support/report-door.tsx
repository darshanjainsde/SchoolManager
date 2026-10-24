'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ReportProblem } from './report-problem';

/**
 * The sidebar's "Report a problem" door. Lives in the footer beside the theme
 * toggle on every console page, so the broken screen is one click from the
 * form that reports it — and the form already knows which page it came from.
 */
export function ReportDoor({ collapsed = false, onOpen }: { collapsed?: boolean; onOpen?: () => void }) {
  const pathname = usePathname() ?? '/app';
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); onOpen?.(); }}
        title={collapsed ? 'Report a problem' : undefined}
        aria-label={collapsed ? 'Report a problem' : undefined}
        data-testid="report-door"
        className={cn(
          'flex w-full items-center rounded-lg text-sm hover:bg-white/5',
          collapsed ? 'justify-center py-2' : 'gap-3 px-3 py-2',
        )}
      >
        <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden="true" />
        {!collapsed && 'Report a problem'}
      </button>
      {open && <ReportProblem pagePath={pathname} onClose={() => setOpen(false)} />}
    </>
  );
}

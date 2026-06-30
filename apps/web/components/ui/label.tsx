import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Label({
  children,
  className,
  hint,
  required,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement> & { hint?: ReactNode; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label className={cn('text-sm font-medium text-slate-700', className)} {...rest}>
        {children} {required && <span className="text-rose-600">*</span>}
      </label>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

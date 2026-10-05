'use client';
import { useRef } from 'react';
import { Bold, Italic, List, ListOrdered } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { applyFormat, type FormatAction } from './format-text';

/**
 * A textarea for the public site's text grammar (components/public/page-text.ts)
 * with a toolbar that TYPES the marks for you. The stored value is the same
 * plain string a school could have typed by hand — the buttons are a shortcut
 * to `**`, `*`, `- ` and `1. `, never a second format.
 */
const TOOLS: { action: FormatAction; label: string; Icon: typeof Bold }[] = [
  { action: 'bold', label: 'Bold', Icon: Bold },
  { action: 'italic', label: 'Italic', Icon: Italic },
  { action: 'bullets', label: 'Bulleted list', Icon: List },
  { action: 'numbers', label: 'Numbered list', Icon: ListOrdered },
];

export function FormatTextarea({
  value,
  onChange,
  maxLength,
  rows = 4,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function run(action: FormatAction) {
    const el = ref.current;
    if (!el) return;
    const out = applyFormat(value, el.selectionStart, el.selectionEnd, action);
    if (out.value.length > maxLength) return;
    onChange(out.value);
    // Restore the selection after React commits the new value.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(out.start, out.end);
    });
  }

  const near = value.length > maxLength * 0.9;

  return (
    <div className="rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-slate-400">
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 border-b border-slate-200 px-1.5 py-1">
        {TOOLS.map(({ action, label, Icon }) => (
          <button
            key={action}
            type="button"
            title={label}
            aria-label={label}
            // Keep the textarea's selection: a mousedown on the button would
            // otherwise blur it before the click handler reads the range.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(action)}
            className="sk-press grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <span className={`ml-auto pr-1.5 text-[11px] tabular-nums ${near ? 'text-amber-700' : 'text-slate-500'}`}>
          {value.length}/{maxLength}
        </span>
      </div>
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[96px] resize-y rounded-t-none border-0 focus-visible:ring-0"
      />
    </div>
  );
}

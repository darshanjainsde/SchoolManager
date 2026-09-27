import { CONCERN_CATEGORIES, CONCERN_CATEGORY_LABEL, type ConcernCategory } from '@skoolos/types';

/** "2 days", "today" — how long a family has been waiting, not a timestamp. */
export function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/** The categories, in the order a family meets them on the form. */
export const CATEGORY_OPTIONS: { value: ConcernCategory; label: string }[] =
  CONCERN_CATEGORIES.map((value) => ({ value, label: CONCERN_CATEGORY_LABEL[value] }));

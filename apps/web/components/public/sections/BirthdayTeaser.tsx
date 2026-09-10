'use client';
import Link from 'next/link';
import type { BirthdaysResult } from '@/lib/public-api';
import type { CelebrationsTeaser } from '../celebrations-config';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The homepage hint that somebody has a birthday (Active Roster, Track B).
 * Small, moves a little, opens /birthdays. Two looks:
 *  - CAKE_BADGE: a corner pill with a flickering candle and a count.
 *  - RIBBON: a strip under the menu; the names scroll past.
 * Both freeze under animationLevel NONE and prefers-reduced-motion (ps-css).
 */
export default function BirthdayTeaser({ style, data, href }: { style: CelebrationsTeaser; data: BirthdaysResult; href: string }) {
  const n = data.today.length;
  if (style === 'RIBBON') {
    const items = [...data.today, ...data.upcoming].slice(0, 8);
    if (items.length === 0) return null;
    const lead = n > 0 ? 'Today we celebrate' : 'Birthdays this week';
    return (
      <Link href={href} className="ps-bd-ribbon" aria-label={`${lead}: ${items.map((r) => r.name).join(', ')}. Open the birthdays page.`}>
        <span className="ps-bd-ribbon-lead">{lead}</span>
        {/* The names scroll inside their own clipped viewport, so they can never run under the label. */}
        <span className="ps-bd-ribbon-view" aria-hidden="true">
        <span className="ps-bd-ribbon-track">
          {[0, 1].map((rep) =>
            items.map((r) => (
              <span key={`${rep}-${r.key}`}>
                <b>{r.name}</b>
                {r.classLabel ? <i>{r.classLabel}</i> : null}
                {n === 0 || data.today.every((t) => t.key !== r.key) ? <i>{`${r.day} ${MONTHS[r.month - 1]}`}</i> : null}
              </span>
            )),
          )}
          <span>See all birthdays →</span>
        </span>
        </span>
      </Link>
    );
  }
  const label = n > 0 ? `${n} today` : data.next ? `Next: ${data.next.name}` : 'This month';
  return (
    <Link href={href} className="ps-bd-badge" aria-label={`Birthdays: ${label}. Open the birthdays page.`}>
      <span className="ps-bd-cake" aria-hidden="true">
        <svg viewBox="0 0 26 26" width="24" height="24">
          <rect x="4" y="12" width="18" height="10" rx="2" fill="#FB7185" />
          <rect x="4" y="12" width="18" height="4" rx="2" fill="#fff" />
          <rect x="12" y="4" width="2.4" height="8" fill="var(--ps1)" />
        </svg>
        <span className="ps-bd-flame" />
      </span>
      <span>Birthdays</span>
      <span className="ps-bd-count">{label}</span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

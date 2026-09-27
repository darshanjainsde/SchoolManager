/**
 * The contact icons, drawn.
 *
 * Shared by the footer and the Contact band because they show the same four
 * facts and used to disagree about how: both shipped 📞 ✉️ 📍 as literal
 * emoji, which the device renders in its own emoji font — a different page on
 * every phone, and the only cartoon on an otherwise serious school site
 * (reported 2026-09-27). One component so they cannot drift again.
 *
 * `currentColor` throughout: the same icon sits on paper, on the school's
 * colour and on a dark festive band without a second copy.
 */
export function Ico({ name }: { name: 'phone' | 'mail' | 'pin' | 'clock' | 'wa' }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'ps-foot-ico',
  };
  if (name === 'phone') {
    return (
      <svg {...common}>
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
      </svg>
    );
  }
  if (name === 'mail') {
    return (
      <svg {...common}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m2 7 10 6 10-6" />
      </svg>
    );
  }
  if (name === 'pin') {
    return (
      <svg {...common}>
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    );
  }
  if (name === 'clock') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20.5l1.8-5.2A8.4 8.4 0 1 1 21 11.5Z" />
      <path d="M8.6 9.2c.3 1.6 2.6 4 4.2 4.2l1-1 1.9.9v1.4c-2.4.4-6.6-3-7.2-5.6l1.3-.6Z" />
    </svg>
  );
}

/** `tel:` wants no spaces. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`;
}

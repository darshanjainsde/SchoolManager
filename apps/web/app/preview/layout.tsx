import type { Metadata } from 'next';

// The studio canvas mirrors a school's live site data; it must never be
// indexed as a duplicate of the real public pages.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}

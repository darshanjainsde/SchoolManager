import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import PlatformBlogNav from '@/components/blog/PlatformBlogNav';
import EarnPage from '@/components/earn/EarnPage';
import '@/components/marketing/marketing.css';
import '@/components/earn/earn.css';

export const metadata: Metadata = {
  title: 'Refer & earn with Sckools — introduce a school, get paid when it goes live',
  description:
    'Know a school? Introduce it to Sckools. We do the demo, the proposal and the onboarding; when the school goes live and pays, you earn a share. Your rate is set in your account.',
  alternates: { canonical: 'https://sckools.com/earn' },
};

/**
 * Refer & Earn, the public page. Deliberately says nothing about rates: a
 * promoter's commission is set per person by the owner, inside the account,
 * after the questionnaire. The page's one job is to get someone to the door.
 */
export default async function Page() {
  const host = await getRequestHost();
  if (!isPlatformHost(host)) notFound();
  return (
    <>
      <PlatformBlogNav variant="earn" />
      <EarnPage />
    </>
  );
}

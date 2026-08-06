import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchPublicSite } from '@/lib/public-api';
import { isPlatformHost } from '@/lib/hosts';
import { getRequestHost } from '@/lib/request';
import SchoolChrome from '@/components/public/SchoolChrome';
import { navModel } from '@/components/public/sections/nav-model';
import type { NavConfig } from '@/components/public/sections/nav-config';

/**
 * The generated overview page for a nav group.
 *
 * §3 of the Phase 6 plan offers three behaviours for a group, and `overview` is
 * "the only option that gives search engines somewhere to land". It shipped as
 * a selectable option that did nothing at all — the editor offered it, the
 * model treated it as a plain menu, and no page existed. This is that page.
 *
 * It is a DYNAMIC route at the root, which sounds alarming and is not: Next
 * resolves static segments first, so /academics, /gallery, /connect and the
 * rest still win. This only ever answers for a slug the school itself created,
 * and 404s for everything else.
 */
function groupFor(config: NavConfig | null | undefined, slug: string) {
  return config?.items?.find((i) => i.slug === slug && i.behaviour === 'overview') ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ navGroup: string }>;
}): Promise<Metadata> {
  const host = await getRequestHost();
  if (isPlatformHost(host)) return {};
  const { navGroup } = await params;
  const data = await fetchPublicSite(host);
  const group = groupFor(data?.profile?.navConfig as NavConfig | null, navGroup);
  if (!group || !data) return {};
  return {
    title: `${group.label} — ${data.school.name}`,
    description: `${group.label} at ${data.school.name}.`,
  };
}

export default async function NavGroupOverviewPage({
  params,
}: {
  params: Promise<{ navGroup: string }>;
}) {
  const host = await getRequestHost();
  if (isPlatformHost(host)) notFound();

  const { navGroup } = await params;
  const data = await fetchPublicSite(host);
  if (!data) notFound();

  const config = (data.profile?.navConfig ?? null) as NavConfig | null;
  const group = groupFor(config, navGroup);
  // Only a group the school marked as an overview has a page here.
  if (!group) notFound();

  // Resolve the children through the SAME model the menu uses, so an overview
  // can never list a page the menu does not, or link somewhere else.
  const nodes = navModel({
    flags: {
      hasAbout: !!data.homepage?.aboutText,
      hasAcademics: data.courses.length > 0,
      hasAdmissions: true,
      hasHof: true,
      hasGallery: data.school.features.includes('GALLERY'),
      hasEvents: data.school.features.includes('EVENTS'),
      hasBlog: data.school.features.includes('BLOG'),
      hasContact: !!(data.profile?.phone || data.profile?.email || data.profile?.addressLine1),
      hasEnquiry: data.school.features.includes('ENQUIRY'),
    },
    base: '/',
    courses: data.courses,
    config,
  });
  const node = nodes.find((n) => n.key === group.key);
  const children = node && node.kind === 'group' ? node.children : [];

  return (
    <SchoolChrome data={data}>
      <div className="max-w-6xl mx-auto px-6 py-14">
        <header className="ps-masthead">
          <div className="ps-masthead-eyebrow" style={{ color: 'var(--ps1)' }}>
            {data.school.name}
          </div>
          <div className="ps-masthead-split">
            <h1 className="ps-head ps-masthead-title">
              <span className="ps-accent-mark">{group.label}</span>
            </h1>
          </div>
        </header>

        {children.length === 0 ? (
          <p className="mt-8 text-sm text-slate-500">Nothing is listed here yet.</p>
        ) : (
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {children.map((child) => (
              <Link key={child.key} href={child.href} className="reveal ps-lift ps-panel p-6 block">
                <h2 className="ps-head font-bold text-lg">{child.label}</h2>
                {child.hint && <p className="text-sm text-slate-500 mt-1">{child.hint}</p>}
                <span className="mt-4 inline-block text-sm font-semibold" style={{ color: 'var(--ps1)' }}>
                  Open →
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </SchoolChrome>
  );
}

'use client';

import type { PublicSiteData } from '@/lib/public-api';

interface Props {
  data: PublicSiteData;
}

export default function PublicSite({ data }: Props) {
  return (
    <main>
      <h1>{data.school.name}</h1>
      <p>{data.homepage?.headline}</p>
    </main>
  );
}

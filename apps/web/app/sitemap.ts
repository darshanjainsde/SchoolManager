import type { MetadataRoute } from 'next';

/** Marketing pages only — school sites manage their own discoverability. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://sckools.com/', changeFrequency: 'weekly', priority: 1 },
    { url: 'https://sckools.com/pricing', changeFrequency: 'weekly', priority: 0.9 },
  ];
}

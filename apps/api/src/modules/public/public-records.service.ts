import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { FeatureResolverService } from '../features';
import { SportsBookService, type BookLine } from '../sports';
import { formatPublicName, normalizeRecordsConfig, type RecordsSiteConfig } from '../cms/internal/records-config';

export interface PublicRecordsBook {
  generatedAt: string;
  nameFormat: RecordsSiteConfig['nameFormat'];
  pageLayout: RecordsSiteConfig['pageLayout'];
  showTopFive: boolean;
  lines: BookLine[];
  /** Line keys the homepage band shows, in order. */
  home: string[];
}

/**
 * The Book of Records for the public host. 404 unless the school has the
 * Sports wing, switched the book on and confirmed consent — nothing about a
 * book that is not public leaves the school. Names arrive already in the
 * school's chosen format; no ids, classes or dates of birth ever do.
 */
@Injectable()
export class PublicRecordsService {
  constructor(private readonly features: FeatureResolverService, private readonly book: SportsBookService) {}

  async forPublic(schoolId: string): Promise<PublicRecordsBook> {
    const profile = await withTenant(schoolId, (tx) => tx.schoolProfile.findUnique({ where: { schoolId }, select: { recordsConfig: true } }));
    const cfg = normalizeRecordsConfig(profile?.recordsConfig);
    if (!cfg.enabled || !cfg.consentConfirmed) throw new NotFoundException('Not found');
    if (!(await this.features.getFeatures(schoolId)).has('SPORTS')) throw new NotFoundException('Not found');
    const lines = await this.book.book(schoolId, { formatName: (n) => formatPublicName(n, cfg.nameFormat), groups: cfg.groups, topN: cfg.showTopFive ? 5 : 1 });
    return { generatedAt: new Date().toISOString(), nameFormat: cfg.nameFormat, pageLayout: cfg.pageLayout, showTopFive: cfg.showTopFive, lines, home: homeKeys(cfg, lines) };
  }
}

/** The homepage shows lines WITH a record: the newest first, the pinned ones in the office's order, or all of them. */
export function homeKeys(cfg: RecordsSiteConfig, lines: BookLine[]): string[] {
  const withRecord = lines.filter((l) => l.record);
  if (cfg.homeScope === 'PINNED') return cfg.pinned.filter((k) => withRecord.some((l) => l.key === k));
  if (cfg.homeScope === 'ALL') return withRecord.map((l) => l.key);
  return [...withRecord]
    .sort((a, b) => (b.record!.setOn ?? String(b.record!.year)).localeCompare(a.record!.setOn ?? String(a.record!.year)) || b.record!.year - a.record!.year)
    .slice(0, cfg.homeCount)
    .map((l) => l.key);
}

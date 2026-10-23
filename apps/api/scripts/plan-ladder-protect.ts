/**
 * Plan Ladder v2 (2026-10-22) moved five override-only modules into Pro:
 * ALUMNI, PRESS, SPORTS, SALARY and COURSE_MANAGEMENT. Deployed as is, every
 * live Pro school would find five new sidebar items the next morning.
 *
 * This script keeps the day of the deploy a no-op for them: for each school on
 * the PRO tier it writes a DISABLED override for every one of those keys that
 * has no override row yet. Schools that already had a module switched on by
 * hand keep it (their enabled row is left alone). The owner then lifts the
 * protection per school from owner.sckools.com → Schools → the school → Feature
 * flags, with a message to that school.
 *
 * EXAM_HALL and WHATSAPP are deliberately NOT protected: Pro schools already had
 * the seating desk and the WhatsApp settings through MANAGEMENT, so leaving them
 * on preserves what those schools have today.
 *
 * Idempotent; safe to run twice. Run it against the target database BEFORE the
 * deploy that carries the new tier sets:
 *
 *   DATABASE_URL=… pnpm --filter @skoolos/api exec tsx scripts/plan-ladder-protect.ts
 *   DATABASE_URL=… pnpm --filter @skoolos/api exec tsx scripts/plan-ladder-protect.ts --dry-run
 *
 * Deliberately a plain PrismaClient with an explicit URL, like the seed
 * scripts beside it: `loadEnv()` would read the local .env over the exported
 * URL, and this script must act on exactly the database it was pointed at.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const dryRun = process.argv.includes('--dry-run');
const db = new PrismaClient({ datasources: { db: { url } } });

export const PROTECTED_KEYS = ['ALUMNI', 'PRESS', 'SPORTS', 'SALARY', 'COURSE_MANAGEMENT'] as const;

async function main() {
  const schools = await db.school.findMany({
    where: { tier: 'PRO' },
    select: { id: true, slug: true, status: true, featureOverrides: { select: { featureKey: true, enabled: true } } },
    orderBy: { slug: 'asc' },
  });
  let written = 0;
  for (const s of schools) {
    const have = new Set(s.featureOverrides.map((o) => o.featureKey));
    const missing = PROTECTED_KEYS.filter((k) => !have.has(k));
    if (missing.length === 0) {
      console.log(`  = ${s.slug} (${s.status}): every protected key already has an override`);
      continue;
    }
    console.log(`  ${dryRun ? '~' : '+'} ${s.slug} (${s.status}): ${missing.join(', ')} → off`);
    if (dryRun) continue;
    await db.featureOverride.createMany({
      data: missing.map((featureKey) => ({ schoolId: s.id, featureKey, enabled: false })),
      skipDuplicates: true,
    });
    written += missing.length;
  }
  console.log(`${dryRun ? 'Would write' : 'Wrote'} ${written} disabled override${written === 1 ? '' : 's'} across ${schools.length} Pro school${schools.length === 1 ? '' : 's'}.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());

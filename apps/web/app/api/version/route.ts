import { NextResponse } from 'next/server';

/**
 * What is actually running here.
 *
 * Pushing a commit and *deploying* it are different events, and the gap between
 * them is where "but I fixed that" comes from. This lets the local dashboard
 * compare each environment against the branch head and show the drift.
 *
 * Only the short SHA and branch are exposed — enough to identify a build,
 * useless without access to the repository.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return NextResponse.json(
    {
      commit: sha ? sha.slice(0, 7) : null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      env: process.env.VERCEL_ENV ?? 'local',
      builtAt: process.env.VERCEL_DEPLOYMENT_ID ? undefined : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

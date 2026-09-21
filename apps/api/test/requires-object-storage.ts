/**
 * One e2e test actually PUTs a file, and therefore needs reachable object
 * storage — MinIO locally, Supabase Storage in the deployed environments.
 *
 * Without it `StorageService` answers its deliberate typed 503 ("object
 * storage is unreachable"), the test reports `expected 201, got 503`, and the
 * run is red for a reason that has nothing to do with the code under review.
 * That is the same failure shape `requires-live-api.ts` was written for: a
 * missing prerequisite wearing the costume of a broken product.
 *
 * The opt-in is explicit rather than probed, for the same reason as there — a
 * bucket that exists but is the wrong one answers a health check perfectly and
 * then fails the assertion.
 *
 *     docker compose up -d minio
 *     E2E_OBJECT_STORAGE=1 S3_ENDPOINT=http://localhost:9000 \
 *       S3_ACCESS_KEY=... S3_SECRET_KEY=... S3_BUCKET=skoolos \
 *       pnpm --filter @skoolos/api test:e2e
 */
const ENABLED = process.env.E2E_OBJECT_STORAGE === '1';

/** `it` when object storage is explicitly available, else `it.skip`. */
export const itWithObjectStorage: jest.It = ENABLED ? it : it.skip;

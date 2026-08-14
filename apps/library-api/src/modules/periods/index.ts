export { PeriodsModule } from './internal/periods.module';
/** Moved to `@library/core` (`packages/library-core/src/attendance.ts`)
 *  alongside `issue`, its only caller — that package cannot import
 *  `apps/library-api`. Re-exported here so this module's public interface,
 *  and the "attendance is a by-product of a transaction" rule it names, still
 *  has exactly one implementation and one place to import it from. */
export { markPresentByTransaction } from '@library/core';

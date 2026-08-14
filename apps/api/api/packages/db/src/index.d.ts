import { Prisma, PrismaClient } from '@prisma/client';
export type TenantTx = Prisma.TransactionClient;
export declare function getTenantPrisma(): PrismaClient;
export declare function getPlatformPrisma(): PrismaClient;
export declare function withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>, client?: PrismaClient): Promise<T>;
/** Useful in tests and the seed: tear down + close. */
export declare function disconnectAll(): Promise<void>;
export { PrismaClient } from '@prisma/client';
export * from '@prisma/client';
export * from './features';
export * from './default-content';
export * from './blog-blocks';
//# sourceMappingURL=index.d.ts.map
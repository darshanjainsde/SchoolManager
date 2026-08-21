export declare class HealthController {
    private readonly redis;
    constructor();
    health(): {
        status: string;
    };
    ready(): Promise<{
        status: string;
        db: string;
        redis: string;
    }>;
    private checkDb;
    private checkRedis;
}
//# sourceMappingURL=health.controller.d.ts.map
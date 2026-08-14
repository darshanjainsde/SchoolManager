import type { DomainEvent, EventHandler } from '@skoolos/types';
/**
 * In-process event bus used today. Shaped so it can be replaced by a real
 * broker (NATS / RabbitMQ) once a module is extracted into its own service —
 * publishers/subscribers depend only on this interface.
 */
export declare class EventBus {
    private readonly emitter;
    private readonly logger;
    constructor();
    publish<T extends DomainEvent>(event: T): void;
    subscribe<T extends DomainEvent>(name: T['name'] | '*', handler: EventHandler<T>): () => void;
}
//# sourceMappingURL=event-bus.service.d.ts.map
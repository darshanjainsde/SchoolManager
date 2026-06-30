// Cross-cutting types shared by api/web/worker.
// Each phase adds DTOs/enums here; in Phase 0 we only export the domain event base.

export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  name: TName;
  occurredAt: string;
  tenantId?: string;
  payload: TPayload;
}

export type EventHandler<TEvent extends DomainEvent = DomainEvent> = (
  event: TEvent,
) => void | Promise<void>;

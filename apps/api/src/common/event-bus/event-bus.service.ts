import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { DomainEvent, EventHandler } from '@skoolos/types';

/**
 * In-process event bus used today. Shaped so it can be replaced by a real
 * broker (NATS / RabbitMQ) once a module is extracted into its own service —
 * publishers/subscribers depend only on this interface.
 */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });
  private readonly logger = new Logger(EventBus.name);

  constructor() {
    this.emitter.setMaxListeners(100);
    this.emitter.on('error', (err) => this.logger.error('EventBus listener error', err));
  }

  publish<T extends DomainEvent>(event: T): void {
    this.logger.debug?.(`publish ${event.name}`);
    this.emitter.emit(event.name, event);
    this.emitter.emit('*', event);
  }

  subscribe<T extends DomainEvent>(name: T['name'] | '*', handler: EventHandler<T>): () => void {
    const wrapped = (event: T) => {
      Promise.resolve(handler(event)).catch((err) =>
        this.logger.error(`Handler for ${name} failed`, err),
      );
    };
    this.emitter.on(name, wrapped);
    return () => this.emitter.off(name, wrapped);
  }
}

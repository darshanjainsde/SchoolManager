import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';

/**
 * In-process SSE pub/sub. Suitable for single-replica deploys (Railway hobby,
 * one Render instance). For multi-replica fanout, swap the emitter for a
 * Redis pub/sub bridge — the interface is the same. We keep the service tiny
 * so that swap is a 20-line change.
 *
 * Channels are scoped: `<schoolId>:<scope>` so listeners in tenant A never
 * see tenant B's messages even by mistake.
 */
@Injectable()
export class SseBusService {
  private readonly logger = new Logger(SseBusService.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // Don't crash on slow/dropped consumers — log + drop.
    this.emitter.setMaxListeners(0);
  }

  publish(schoolId: string, scope: string, payload: unknown): void {
    this.emitter.emit(channel(schoolId, scope), payload);
  }

  /** Returns an unsubscribe fn. */
  subscribe(schoolId: string, scope: string, handler: (payload: unknown) => void): () => void {
    const c = channel(schoolId, scope);
    this.emitter.on(c, handler);
    return () => this.emitter.off(c, handler);
  }
}

function channel(schoolId: string, scope: string): string {
  return `${schoolId}:${scope}`;
}

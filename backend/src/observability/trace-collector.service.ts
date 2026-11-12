import { Injectable } from '@nestjs/common';
import type { TraceEvent, TraceStage } from '../agent/schemas';

export interface TraceSession {
  add(event: Omit<TraceEvent, 'step' | 'timestamp'> & { timestamp?: string }): TraceEvent;
  all(): TraceEvent[];
}

@Injectable()
export class TraceCollectorService {
  createSession(): TraceSession {
    const events: TraceEvent[] = [];

    return {
      add: (event) => {
        const entry: TraceEvent = {
          ...event,
          step: events.length + 1,
          timestamp: event.timestamp ?? new Date().toISOString(),
        };
        events.push(entry);
        return entry;
      },
      all: () => [...events],
    };
  }
}

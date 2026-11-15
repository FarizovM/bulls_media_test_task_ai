import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

export interface PromptInjectionEvent {
  requestId: string;
  actorSubject: string;
  detectionCode: 'PROMPT_INJECTION_DETECTED';
  inputLength: number;
}

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async recordPromptInjection(event: PromptInjectionEvent): Promise<void> {
    // Never include the prompt itself in logs or the audit table. It may contain PII or attack content.
    const safeEvent = {
      event: 'security.prompt_injection.detected',
      requestId: event.requestId,
      actorSubject: event.actorSubject,
      detectionCode: event.detectionCode,
      inputLength: event.inputLength,
    };
    this.logger.warn(JSON.stringify(safeEvent));

    if (!this.database.enabled) return;

    try {
      await this.database.savePromptInjectionEvent({
        eventId: randomUUID(),
        ...event,
      });
    } catch {
      // The request remains blocked; stdout logging remains available for the platform log collector.
      this.logger.error(JSON.stringify({
        event: 'security.prompt_injection.audit_persist_failed',
        requestId: event.requestId,
      }));
    }
  }
}

import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { z } from 'zod';
import { TriageResponseSchema } from './schemas';
import type {
  AgentDecision,
  AgentRunContext,
  ProposedDecision,
  TriageResponse,
} from './schemas';
import { GuardrailsService } from './guardrails.service';
import { AGENT_INSTRUCTIONS } from './prompts';
import { ToolsService } from '../tools/tools.service';
import { TraceCollectorService, TraceSession } from '../observability/trace-collector.service';
import { SecurityAuditService } from '../observability/security-audit.service';
import { withRetry } from '../observability/retry.util';

const CreateResolutionTicketInputSchema = z.object({
  proposedDecision: z.enum([
    'APPROVED_AUTO_REFUND',
    'REJECTED_BY_POLICY',
    'ESCALATED_TO_HUMAN',
  ]),
});

const createResolutionTicketTool = {
  type: 'function' as const,
  name: 'create_resolution_ticket',
  description: 'Record a proposed return resolution after the server has supplied verified order and policy facts.',
  parameters: {
    type: 'object' as const,
    properties: {
      proposedDecision: {
        type: 'string' as const,
        enum: ['APPROVED_AUTO_REFUND', 'REJECTED_BY_POLICY', 'ESCALATED_TO_HUMAN'],
      },
    },
    required: ['proposedDecision'],
    additionalProperties: false as const,
  },
  strict: true as const,
};

@Injectable()
export class AgentOrchestratorService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(GuardrailsService) private readonly guardrails: GuardrailsService,
    @Inject(ToolsService) private readonly tools: ToolsService,
    @Inject(TraceCollectorService) private readonly traceCollector: TraceCollectorService,
    @Inject(SecurityAuditService) private readonly securityAudit: SecurityAuditService,
  ) { }

  async triage(
    message: string,
    idempotencyKey: string = randomUUID(),
    actorId = 'local-development',
    requestId: string = randomUUID(),
  ): Promise<TriageResponse> {
    const startedAt = Date.now();
    const trace = this.traceCollector.createSession();
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    const mockSetting = this.config.get<string>('MOCK_LLM', 'true').toLowerCase();
    if (mockSetting !== 'true' && mockSetting !== 'false') {
      throw new ServiceUnavailableException('Agent configuration is invalid.');
    }
    const mockEnabled = mockSetting === 'true';
    if (!mockEnabled && !apiKey) {
      throw new ServiceUnavailableException('The AI provider is not configured.');
    }
    const mode: TriageResponse['mode'] = mockEnabled ? 'mock' : 'openai';

    const guardrailStarted = Date.now();
    const guardrailResult = this.guardrails.validate(message);
    trace.add({
      stage: 'GUARDRAIL',
      input: { length: message.length },
      output: guardrailResult,
      durationMs: Date.now() - guardrailStarted,
    });

    if (!guardrailResult.accepted) {
      if (guardrailResult.reasonCode === 'PROMPT_INJECTION_DETECTED') {
        await this.securityAudit.recordPromptInjection({
          requestId,
          actorSubject: actorId,
          detectionCode: 'PROMPT_INJECTION_DETECTED',
          inputLength: message.length,
        });
      }
      return this.finish(
        this.baseDecision({
          status: 'REFUSED_GUARDRAIL',
          reasonCode: guardrailResult.reasonCode,
          summary: guardrailResult.message,
          customerEmailDraft: null,
        }),
        trace,
        startedAt,
        mode,
      );
    }

    const orderId = this.extractOrderId(message);
    if (!orderId) {
      return this.finish(
        this.baseDecision({
          status: 'MISSING_INFORMATION',
          reasonCode: 'ORDER_ID_REQUIRED',
          summary: 'Надішли номер замовлення (наприклад, ORD-1001), щоб я перевірив покупку та правила повернення.',
          customerEmailDraft: null,
        }),
        trace,
        startedAt,
        mode,
      );
    }

    const context: AgentRunContext = { message, orderId, idempotencyKey, actorId };
    const lookupStarted = Date.now();
    trace.add({
      stage: 'TOOL_CALL',
      toolName: 'get_order_details',
      input: { orderId },
      durationMs: 0,
    });
    const order = await this.tools.getOrderDetails(orderId);
    trace.add({
      stage: 'TOOL_RESULT',
      toolName: 'get_order_details',
      output: 'daysSincePurchase' in order
        ? {
          orderId: order.orderId,
          category: order.category,
          totalAmountUsd: order.totalAmountUsd,
          daysSincePurchase: order.daysSincePurchase,
        }
        : { found: false, orderId },
      durationMs: Date.now() - lookupStarted,
    });

    if (!('daysSincePurchase' in order)) {
      return this.finish(
        this.baseDecision({
          status: 'MISSING_INFORMATION',
          orderId,
          reasonCode: 'ORDER_NOT_FOUND',
          summary: `Не знайшов замовлення ${orderId}. Перевір номер і надішли його ще раз. Тікет не створено.`,
          customerEmailDraft: null,
        }),
        trace,
        startedAt,
        mode,
      );
    }

    const verifiedOrder = order;
    context.order = verifiedOrder;
    const policyStarted = Date.now();
    trace.add({
      stage: 'TOOL_CALL',
      toolName: 'search_return_policy',
      input: { category: verifiedOrder.category, queryLength: message.length },
      durationMs: 0,
    });
    context.policy = this.tools.searchReturnPolicy(message, verifiedOrder.category);
    trace.add({
      stage: 'TOOL_RESULT',
      toolName: 'search_return_policy',
      output: context.policy,
      durationMs: Date.now() - policyStarted,
    });

    const existingTicket = await this.tools.findExistingTicket(context);
    if (existingTicket) {
      trace.add({
        stage: 'TOOL_RESULT',
        toolName: 'idempotency_replay',
        output: { ticketId: existingTicket.ticketId, status: existingTicket.status },
        durationMs: 0,
      });
      return this.finish(this.decisionFromTicket(existingTicket), trace, startedAt, mode);
    }

    let ticket = context.ticket;
    if (mode === 'mock') {
      trace.add({
        stage: 'PLANNING',
        input: { orderId: verifiedOrder.orderId, policyAvailable: true },
        output: {
          provider: 'Детермінований планувальник без API',
          reason: 'Використовує ті самі інструменти й серверні перевірки без запиту до моделі.',
        },
        durationMs: 0,
      });
      const mockProposal = this.createMockProposal(message);
      ticket = await this.runCreateTicketTool({
        orderId,
        proposedDecision: mockProposal,
        refundAmountUsd: verifiedOrder.totalAmountUsd,
      }, context, trace);
    } else {
      const client = new OpenAI({ apiKey, timeout: 10_000, maxRetries: 0 });
      try {
        ticket = await this.runOpenAiPlanner(client, context, trace);
      } catch (error) {
        trace.add({
          stage: 'PLANNING',
          input: { provider: 'OpenAI' },
          output: { fallback: 'escalate to a person', errorCode: this.errorCode(error) },
          durationMs: 0,
        });

        if (!context.ticket) {
          ticket = await this.runCreateTicketTool({
            orderId,
            proposedDecision: 'ESCALATED_TO_HUMAN',
            refundAmountUsd: verifiedOrder.totalAmountUsd,
          }, context, trace);
        } else {
          ticket = context.ticket;
        }
      }
    }

    if (!ticket) {
      ticket = await this.runCreateTicketTool({
        orderId,
        proposedDecision: 'ESCALATED_TO_HUMAN',
        refundAmountUsd: verifiedOrder.totalAmountUsd,
      }, context, trace);
    }

    const decision = this.decisionFromTicket(ticket);
    return this.finish(decision, trace, startedAt, mode);
  }

  private async runOpenAiPlanner(
    client: OpenAI,
    context: AgentRunContext,
    trace: TraceSession,
  ) {
    const model = this.config.get<string>('OPENAI_MODEL', 'gpt-6-luna');
    const plannerStarted = Date.now();
    const response = await this.withTracedRetry(
      () => client.responses.create({
        model,
        instructions: AGENT_INSTRUCTIONS,
        input: JSON.stringify({
          customerMessage: redactSensitiveInput(context.message),
          verifiedOrder: context.order && {
            orderId: context.order.orderId,
            itemName: context.order.itemName,
            category: context.order.category,
            totalAmountUsd: context.order.totalAmountUsd,
            daysSincePurchase: context.order.daysSincePurchase,
          },
          policySearchResult: context.policy,
          task: 'Choose a proposed status and call create_resolution_ticket exactly once.',
        }),
        tools: [createResolutionTicketTool],
        tool_choice: 'required',
        parallel_tool_calls: false,
      }),
      'OpenAI Responses API',
      trace,
    );

    if (response.status !== 'completed') {
      throw new Error('The model response did not complete successfully.');
    }

    trace.add({
      stage: 'PLANNING',
      input: { model, verifiedOrder: context.order?.orderId },
      output: { responseId: response.id, status: response.status },
      durationMs: Date.now() - plannerStarted,
    });

    const functionCall = response.output.find((item) => item.type === 'function_call');
    if (!functionCall || functionCall.name !== 'create_resolution_ticket') {
      throw new Error('The model did not call the required ticket tool.');
    }

    const proposal = CreateResolutionTicketInputSchema.parse(JSON.parse(functionCall.arguments));
    if (!context.order) throw new Error('Verified order is missing from the run context.');
    return this.runCreateTicketTool({
      ...proposal,
      orderId: context.order.orderId,
      refundAmountUsd: context.order.totalAmountUsd,
    }, context, trace);
  }

  private async runCreateTicketTool(
    input: {
      orderId: string;
      proposedDecision: ProposedDecision;
      reason?: string;
      refundAmountUsd: number;
    },
    context: AgentRunContext,
    trace: TraceSession,
  ) {
    const startedAt = Date.now();
    trace.add({
      stage: 'TOOL_CALL',
      toolName: 'create_resolution_ticket',
      input: { orderId: input.orderId, proposedDecision: input.proposedDecision },
      durationMs: 0,
    });
    const ticket = await this.tools.createResolutionTicket(input, context);
    context.ticket = ticket;
    trace.add({
      stage: 'TOOL_RESULT',
      toolName: 'create_resolution_ticket',
      output: ticket,
      durationMs: Date.now() - startedAt,
    });
    return ticket;
  }

  private async withTracedRetry<T>(
    operation: () => Promise<T>,
    label: string,
    trace: TraceSession,
  ): Promise<T> {
    return withRetry(operation, {
      maxRetries: 1,
      baseDelayMs: 300,
      onRetry: (attempt, error, delayMs) => {
        trace.add({
          stage: 'ERROR_RETRY',
          toolName: label,
          input: { attempt },
          output: { errorCode: this.errorCode(error), delayMs },
          durationMs: 0,
        });
      },
    });
  }

  private createMockProposal(message: string): ProposedDecision {
    if (/manager|supervisor|human|person|менеджер|людин/i.test(message)) {
      return 'ESCALATED_TO_HUMAN';
    }
    if (/no refund|not eligible|не поверта|не можна повернути/i.test(message)) {
      return 'REJECTED_BY_POLICY';
    }
    return 'APPROVED_AUTO_REFUND';
  }

  private extractOrderId(message: string): string | null {
    const match = message.match(/\bORD\s*[-#]?\s*(\d{4,})\b/i);
    return match ? `ORD-${match[1]}` : null;
  }

  private decisionFromTicket(ticket: NonNullable<AgentRunContext['ticket']>): AgentDecision {
    let summary: string;
    let customerEmailDraft: string;

    if (ticket.status === 'APPROVED_AUTO_REFUND') {
      summary = `Замовлення ${ticket.orderId} відповідає правилам автоматичного повернення. У тікеті ${ticket.ticketId} зафіксовано рішення про повернення $${ticket.refundAmountUsd?.toFixed(2)}. Система не переказує кошти.`;
      customerEmailDraft = `Вітаємо!\n\nВаш запит щодо замовлення ${ticket.orderId} схвалено згідно з правилами повернення. Створено тікет ${ticket.ticketId}. Для реального повернення потрібна окрема платіжна система.\n\nЗ повагою,\nСлужба підтримки`;
    } else if (ticket.status === 'REJECTED_BY_POLICY') {
      summary = `Замовлення ${ticket.orderId} не відповідає правилам повернення коштів. ${ticket.note} Рішення зафіксовано в тікеті ${ticket.ticketId}.`;
      customerEmailDraft = `Вітаємо!\n\nМи розглянули запит щодо замовлення ${ticket.orderId}. ${ticket.note} Якщо маєте додаткову інформацію, повідомте її у відповіді та зазначте номер тікета ${ticket.ticketId}.\n\nЗ повагою,\nСлужба підтримки`;
    } else {
      summary = `Запит щодо замовлення ${ticket.orderId} має перевірити фахівець підтримки. ${ticket.note} Створено тікет ${ticket.ticketId}; кошти не переказувалися.`;
      customerEmailDraft = `Вітаємо!\n\nМи передали запит щодо замовлення ${ticket.orderId} фахівцю підтримки. Номер звернення: ${ticket.ticketId}. Ми повідомимо вас про результат перевірки.\n\nЗ повагою,\nСлужба підтримки`;
    }

    return {
      status: ticket.status,
      orderId: ticket.orderId,
      ticketId: ticket.ticketId,
      refundAmountUsd: ticket.status === 'APPROVED_AUTO_REFUND' ? ticket.refundAmountUsd : null,
      reasonCode: ticket.reasonCode,
      policyVersion: ticket.policyVersion,
      deterministicOverrideApplied: ticket.deterministicOverrideApplied,
      humanReadableSummary: summary,
      customerEmailDraft,
    };
  }

  private baseDecision(input: {
    status: AgentDecision['status'];
    orderId?: string | null;
    reasonCode: string;
    summary: string;
    customerEmailDraft: string | null;
  }): AgentDecision {
    return {
      status: input.status,
      orderId: input.orderId ?? null,
      ticketId: null,
      refundAmountUsd: null,
      reasonCode: input.reasonCode,
      policyVersion: null,
      deterministicOverrideApplied: false,
      humanReadableSummary: input.summary,
      customerEmailDraft: input.customerEmailDraft,
    };
  }

  private finish(
    decision: AgentDecision,
    trace: TraceSession,
    startedAt: number,
    mode: TriageResponse['mode'],
  ): TriageResponse {
    const totalDurationMs = Date.now() - startedAt;
    trace.add({
      stage: 'FINAL_OUTPUT',
      output: decision,
      durationMs: 0,
    });
    return TriageResponseSchema.parse({
      decision,
      traces: trace.all(),
      totalDurationMs,
      mode,
    });
  }

  private errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
      return `UPSTREAM_${error.status}`;
    }
    return error instanceof z.ZodError ? 'INVALID_MODEL_OUTPUT' : 'UPSTREAM_REQUEST_FAILED';
  }
}

function redactSensitiveInput(message: string): string {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[phone or account number removed]');
}

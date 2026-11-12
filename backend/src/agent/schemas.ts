import { z } from 'zod';

export const TriageRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export const ResolutionStatusSchema = z.enum([
  'APPROVED_AUTO_REFUND',
  'REJECTED_BY_POLICY',
  'ESCALATED_TO_HUMAN',
  'MISSING_INFORMATION',
  'REFUSED_GUARDRAIL',
]);

export const ProposedDecisionSchema = z.enum([
  'APPROVED_AUTO_REFUND',
  'REJECTED_BY_POLICY',
  'ESCALATED_TO_HUMAN',
]);

export const AgentDecisionSchema = z.object({
  status: ResolutionStatusSchema,
  orderId: z.string().nullable(),
  ticketId: z.string().nullable(),
  refundAmountUsd: z.number().nullable(),
  reasonCode: z.string(),
  policyVersion: z.string().nullable(),
  deterministicOverrideApplied: z.boolean(),
  humanReadableSummary: z.string(),
  customerEmailDraft: z.string().nullable(),
});

export const OrderSchema = z.object({
  orderId: z.string().trim().min(1).max(50),
  customerName: z.string().trim().min(1).max(200),
  itemName: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(100),
  totalAmountUsd: z.number().finite().nonnegative().max(100_000_000),
  purchaseAgeDays: z.number().int().nonnegative(),
});

export const OrdersDatasetSchema = z.array(OrderSchema).min(1).superRefine((orders, context) => {
  const ids = new Set<string>();
  for (const [index, order] of orders.entries()) {
    const canonicalId = order.orderId.trim().toUpperCase();
    if (ids.has(canonicalId)) {
      context.addIssue({ code: 'custom', path: [index, 'orderId'], message: 'Duplicate orderId.' });
    }
    ids.add(canonicalId);
  }
});

export const RefundPolicySchema = z.object({
  policyVersion: z.string().min(1).max(40),
  effectiveFrom: z.iso.date(),
  maxReturnDays: z.number().int().positive().max(3650),
  maxAutoRefundUsd: z.number().finite().positive().max(1_000_000),
  nonRefundableCategories: z.array(z.string().trim().min(1).max(100)).max(100),
});

export const TriageResponseSchema = z.object({
  decision: AgentDecisionSchema,
  traces: z.array(z.object({
    step: z.number().int(),
    timestamp: z.string(),
    stage: z.enum([
      'GUARDRAIL',
      'PLANNING',
      'TOOL_CALL',
      'TOOL_RESULT',
      'ERROR_RETRY',
      'FINAL_OUTPUT',
    ]),
    toolName: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    durationMs: z.number().nonnegative(),
  })),
  totalDurationMs: z.number().nonnegative(),
  mode: z.enum(['mock', 'openai']),
});

export type TriageRequest = z.infer<typeof TriageRequestSchema>;
export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;
export type ProposedDecision = z.infer<typeof ProposedDecisionSchema>;
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type TriageResponse = z.infer<typeof TriageResponseSchema>;

export type TraceStage = z.infer<typeof TriageResponseSchema>['traces'][number]['stage'];
export type TraceEvent = z.infer<typeof TriageResponseSchema>['traces'][number];

export interface Scenario {
  id: string;
  title: string;
  description: string;
  message: string;
  expectedStatus: ResolutionStatus;
}

export interface OrderDetails extends Order {
  purchasedAt: string;
  daysSincePurchase: number;
}

export interface PolicySearchResult {
  policyVersion: string;
  excerpt: string;
  maxReturnDays: number;
  maxAutoRefundUsd: number;
  nonRefundableCategories: string[];
}

export interface ResolutionTicket {
  ticketId: string;
  orderId: string;
  status: ResolutionStatus;
  refundAmountUsd: number | null;
  reasonCode: string;
  deterministicOverrideApplied: boolean;
  note: string;
  policyVersion: string;
}

export interface AgentRunContext {
  message: string;
  orderId: string;
  actorId?: string;
  idempotencyKey?: string;
  order?: OrderDetails;
  policy?: PolicySearchResult;
  ticket?: ResolutionTicket;
}

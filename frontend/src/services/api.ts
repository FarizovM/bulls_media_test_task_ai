import { requireAccessToken } from './auth';

export type ResolutionStatus =
  | 'APPROVED_AUTO_REFUND'
  | 'REJECTED_BY_POLICY'
  | 'ESCALATED_TO_HUMAN'
  | 'MISSING_INFORMATION'
  | 'REFUSED_GUARDRAIL';

export interface Scenario {
  id: string;
  title: string;
  description: string;
  message: string;
  expectedStatus: ResolutionStatus;
}

export interface Order {
  orderId: string;
  customerName: string;
  itemName: string;
  category: string;
  totalAmountUsd: number;
  purchaseAgeDays: number;
  purchasedAt: string;
  daysSincePurchase: number;
}

export interface TraceEvent {
  step: number;
  timestamp: string;
  stage: 'GUARDRAIL' | 'PLANNING' | 'TOOL_CALL' | 'TOOL_RESULT' | 'ERROR_RETRY' | 'FINAL_OUTPUT';
  toolName?: string;
  input?: unknown;
  output?: unknown;
  durationMs: number;
}

export interface Decision {
  status: ResolutionStatus;
  orderId: string | null;
  ticketId: string | null;
  refundAmountUsd: number | null;
  reasonCode: string;
  policyVersion: string | null;
  deterministicOverrideApplied: boolean;
  humanReadableSummary: string;
  customerEmailDraft: string | null;
}

export interface TriageResponse {
  decision: Decision;
  traces: TraceEvent[];
  totalDurationMs: number;
  mode: 'mock' | 'openai';
}

async function getJson<T>(url: string): Promise<T> {
  const response = await authenticatedFetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function getScenarios(): Promise<Scenario[]> {
  return getJson('/api/agent/scenarios');
}

export function getOrders(): Promise<Order[]> {
  return getJson('/api/agent/orders');
}

export async function triage(message: string, idempotencyKey: string): Promise<TriageResponse> {
  const response = await authenticatedFetch('/api/agent/triage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ message }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return body as TriageResponse;
}
async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await requireAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

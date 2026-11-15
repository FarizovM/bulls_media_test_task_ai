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

interface ApiErrorBody {
  message?: unknown;
  retryAfterSeconds?: unknown;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function formatApiError(response: Response, body: ApiErrorBody | null): string {
  const retryAfterHeader = Number(response.headers.get('Retry-After'));
  const retryAfterSeconds =
    typeof body?.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)
      ? Math.max(1, Math.ceil(body.retryAfterSeconds))
      : Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.ceil(retryAfterHeader)
        : null;

  const rawMessage = Array.isArray(body?.message)
    ? body.message.filter((item): item is string => typeof item === 'string').join(' ')
    : typeof body?.message === 'string'
      ? body.message
      : '';

  if (response.status === 429) {
    if (rawMessage && !/^(Rate limit exceeded|The service is temporarily busy)\.?$/i.test(rawMessage)) {
      return rawMessage;
    }
    return retryAfterSeconds
      ? `Перевищено ліміт запитів. Повторіть спробу через ${retryAfterSeconds} с.`
      : 'Перевищено ліміт запитів. Зачекайте трохи та повторіть спробу.';
  }

  if (response.status === 401) return 'Потрібна повторна авторизація.';
  if (response.status === 403) return rawMessage || 'Недостатньо прав для виконання цієї дії.';
  if (response.status >= 500) {
    return rawMessage && rawMessage !== 'Internal server error'
      ? rawMessage
      : 'Внутрішня помилка сервера. Спробуйте ще раз за кілька секунд.';
  }

  return rawMessage || `Помилка запиту (${response.status}).`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await authenticatedFetch(url);
  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(formatApiError(response, (body && typeof body === 'object' ? body : null) as ApiErrorBody | null));
  }
  return body as T;
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

  const body = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(formatApiError(response, (body && typeof body === 'object' ? body : null) as ApiErrorBody | null));
  }
  return body as TriageResponse;
}
async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await requireAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

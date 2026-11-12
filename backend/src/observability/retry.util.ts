export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 2, baseDelayMs = 300, onRetry } = options;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryable(error)) throw error;
      const delayMs = baseDelayMs * (2 ** attempt);
      onRetry?.(attempt + 1, error, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500)
    || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code);
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withRetry } from '../src/observability/retry.util';

describe('withRetry', () => {
  it('retries a transient failure and returns the successful result', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 2) throw Object.assign(new Error('temporary'), { status: 503 });
      return 'ok';
    }, { maxRetries: 2, baseDelayMs: 1 });

    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentRunContext } from '../src/agent/schemas';
import { ToolsService } from '../src/tools/tools.service';

describe('create_resolution_ticket deterministic checks', () => {
  it('overrides an automatic refund proposal when the order is above the $150 limit', async () => {
    const tools = new ToolsService();
    const order = await tools.getOrderDetails('ORD-1002');
    assert.ok('daysSincePurchase' in order);
    const context: AgentRunContext = {
      message: 'The laptop arrived broken. Please refund me.',
      orderId: 'ORD-1002',
      order,
      policy: tools.searchReturnPolicy('broken item refund', order.category),
    };

    const ticket = await tools.createResolutionTicket({
      orderId: 'ORD-1002',
      proposedDecision: 'APPROVED_AUTO_REFUND',
      reason: 'The customer reports a broken laptop.',
      refundAmountUsd: 1200,
    }, context);

    assert.equal(ticket.status, 'ESCALATED_TO_HUMAN');
    assert.equal(ticket.reasonCode, 'AUTO_APPROVAL_AMOUNT_LIMIT');
    assert.equal(ticket.deterministicOverrideApplied, true);
    assert.equal(ticket.refundAmountUsd, null);
  });

  it('overrides an automatic refund proposal when the return window expired', async () => {
    const tools = new ToolsService();
    const order = await tools.getOrderDetails('ORD-1003');
    assert.ok('daysSincePurchase' in order);
    const context: AgentRunContext = {
      message: 'I want to return the shoes.',
      orderId: 'ORD-1003',
      order,
      policy: tools.searchReturnPolicy('return order', order.category),
    };

    const ticket = await tools.createResolutionTicket({
      orderId: 'ORD-1003',
      proposedDecision: 'APPROVED_AUTO_REFUND',
      reason: 'The customer asked for a refund.',
      refundAmountUsd: 80,
    }, context);

    assert.equal(ticket.status, 'REJECTED_BY_POLICY');
    assert.equal(ticket.reasonCode, 'RETURN_WINDOW_EXPIRED');
    assert.equal(ticket.deterministicOverrideApplied, true);
  });
});

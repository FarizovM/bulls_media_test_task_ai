import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentRunContext,
  AgentDecision,
  Order,
  OrderDetails,
  PolicySearchResult,
  ProposedDecision,
  ResolutionStatus,
  ResolutionTicket,
  OrdersDatasetSchema,
  RefundPolicySchema,
} from '../agent/schemas';
import { DatabaseService } from '../database/database.service';

interface CreateTicketInput {
  orderId: string;
  proposedDecision: ProposedDecision;
  reason?: string;
  refundAmountUsd: number;
}

@Injectable()
export class ToolsService {
  private readonly orders: Order[];
  private readonly policyText: string;
  private readonly refundPolicy: ReturnType<typeof RefundPolicySchema.parse>;
  private nextTicketNumber = 10001;
  private readonly tickets: ResolutionTicket[] = [];
  private readonly idempotentTickets = new Map<string, { requestHash: string; ticket: ResolutionTicket }>();

  constructor(@Optional() @Inject(DatabaseService) private readonly database?: DatabaseService) {
    this.orders = OrdersDatasetSchema.parse(JSON.parse(
      readFileSync(join(__dirname, '../data/orders.json'), 'utf8'),
    ));
    this.policyText = readFileSync(
      join(__dirname, '../data/policies/refund-policy.md'),
      'utf8',
    );
    this.refundPolicy = RefundPolicySchema.parse(JSON.parse(
      readFileSync(join(__dirname, '../data/policies/refund-policy.json'), 'utf8'),
    ));
    if (this.refundPolicy.effectiveFrom > new Date().toISOString().slice(0, 10)) {
      throw new Error('The configured refund policy is not effective yet.');
    }
    this.assertPolicyDocumentConsistent();
  }

  async listOrders(): Promise<OrderDetails[]> {
    if (this.database?.enabled) return this.database.listOrders();
    return this.orders.slice(0, 100).map((order) => this.withPurchaseDate(order));
  }

  async getOrderDetails(orderId: string): Promise<OrderDetails | { found: false; orderId: string }> {
    if (this.database?.enabled) {
      const fromDatabase = await this.database.findOrder(orderId);
      return fromDatabase ?? { found: false, orderId: orderId.toUpperCase() };
    }
    const order = this.orders.find(
      (candidate) => candidate.orderId.toUpperCase() === orderId.toUpperCase(),
    );
    return order
      ? this.withPurchaseDate(order)
      : { found: false, orderId: orderId.toUpperCase() };
  }

  searchReturnPolicy(query: string, category?: string | null): PolicySearchResult {
    const maxReturnDays = this.refundPolicy.maxReturnDays;
    const maxAutoRefundUsd = this.refundPolicy.maxAutoRefundUsd;
    const nonRefundableCategories = this.refundPolicy.nonRefundableCategories;

    const headingSections = this.policyText
      .split(/(?=^## )/m)
      .map((section) => section.trim())
      .filter(Boolean);
    const searchTerms = `${query} ${category ?? ''}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > 3);
    const scoredSections = headingSections
      .map((section) => ({
        section,
        score: searchTerms.reduce(
          (total, term) => total + (section.toLowerCase().includes(term) ? 1 : 0),
          0,
        ),
      }))
      .sort((a, b) => b.score - a.score);
    const selected = category?.toLowerCase().includes('подарункова')
      ? scoredSections.find(({ section }) => /товари без повернення|non-refundable/i.test(section))?.section
      : scoredSections[0]?.section;
    const excerpt = (selected ?? this.policyText).slice(0, 900);

    return {
      policyVersion: this.refundPolicy.policyVersion,
      excerpt,
      maxReturnDays,
      maxAutoRefundUsd,
      nonRefundableCategories,
    };
  }

  async createResolutionTicket(
    input: CreateTicketInput,
    context: AgentRunContext,
  ): Promise<ResolutionTicket> {
    if (!context.order || !context.policy) {
      throw new Error('Order lookup and policy search must finish before ticket creation.');
    }
    if (input.orderId.toUpperCase() !== context.order.orderId.toUpperCase()) {
      throw new Error('Ticket orderId does not match the verified order.');
    }

    const order = context.order;
    const policy = context.policy;
    const technicalFailure = /activation|activate|delivery failure|technical|не актив|не отримав код|помилк.*активац/i.test(context.message);
    const refundIntent = /refund|return|money back|поверн|відшкоду|грош|рефанд/i.test(context.message);
    const negatedIntent = /\b(?:do not|don't|not requesting|no need for|no)\s+(?:a\s+)?(?:refund|return)|\b(?:не хочу|не потрібно|не треба|не просив|не просила)\b.{0,35}\b(?:повер|відшкоду|грош)|\bне\s+(?:поверта|відшкодов)/i.test(context.message);
    const isNonRefundable = policy.nonRefundableCategories.some(
      (category) => category.toLowerCase() === order.category.toLowerCase(),
    );

    const supportedReturnReason = /broken|damaged|defect|faulty|not working|wrong item|item not received|size.{0,20}(?:wrong|fit)|пошкодж|розб|брак|несправ|не працює|не той товар|не отримав|не достав|розмір.{0,20}(?:підійш|не той)/i.test(context.message);
    const negatedReason = /\b(?:not|isn't|wasn't|never)\b.{0,20}\b(?:broken|damaged|defective|faulty)|\b(?:не|без)\b.{0,15}\b(?:пошкодж|розб|брак|несправ)/i.test(context.message);
    let status: ResolutionStatus;
    let reasonCode = 'REFUND_WITHIN_POLICY';
    let note: string;
    let deterministicOverrideApplied = false;

    if (order.daysSincePurchase > policy.maxReturnDays) {
      status = 'REJECTED_BY_POLICY';
      reasonCode = 'RETURN_WINDOW_EXPIRED';
      deterministicOverrideApplied = input.proposedDecision !== status;
      note = `Термін повернення становить ${policy.maxReturnDays} днів; від покупки минуло ${order.daysSincePurchase} днів.`;
    } else if (isNonRefundable && technicalFailure) {
      status = 'ESCALATED_TO_HUMAN';
      reasonCode = 'ACTIVATION_FAILURE_REQUIRES_VERIFICATION';
      deterministicOverrideApplied = input.proposedDecision !== status;
      note = 'Цифровий товар не повертається без підтвердження збою активації фахівцем підтримки.';
    } else if (isNonRefundable) {
      status = 'REJECTED_BY_POLICY';
      reasonCode = 'NON_REFUNDABLE_CATEGORY';
      deterministicOverrideApplied = input.proposedDecision !== status;
      note = 'За правилами цифрові подарункові картки не повертаються.';
    } else if (order.totalAmountUsd > policy.maxAutoRefundUsd) {
      status = 'ESCALATED_TO_HUMAN';
      reasonCode = 'AUTO_APPROVAL_AMOUNT_LIMIT';
      deterministicOverrideApplied = input.proposedDecision !== status;
      note = `Сума замовлення перевищує ліміт автоматичного схвалення $${policy.maxAutoRefundUsd}.`;
    } else if (supportedReturnReason && refundIntent && !negatedIntent && !negatedReason) {
      status = 'APPROVED_AUTO_REFUND';
      reasonCode = 'REFUND_WITHIN_POLICY';
      note = 'Замовлення відповідає строку та ліміту автоматичного розгляду; звернення містить підтримувану причину повернення.';
      deterministicOverrideApplied = input.proposedDecision !== status;
    } else {
      status = 'ESCALATED_TO_HUMAN';
      reasonCode = 'MANUAL_REVIEW_REQUESTED';
      note = 'Причина повернення не входить до перевірених сценаріїв автоматичного схвалення; потрібна ручна перевірка.';
      deterministicOverrideApplied = input.proposedDecision !== status;
    }

    const requestHash = this.requestHash(context);
    const idempotencyKey = context.idempotencyKey ?? randomUUID();
    const cached = this.idempotentTickets.get(idempotencyKey);
    if (cached) {
      if (cached.requestHash !== requestHash) throw new Error('Idempotency key was reused with different request data.');
      return cached.ticket;
    }

    const ticket: ResolutionTicket = {
      ticketId: `TCK-${randomUUID()}`,
      orderId: order.orderId,
      status,
      refundAmountUsd: status === 'APPROVED_AUTO_REFUND' ? order.totalAmountUsd : null,
      reasonCode,
      deterministicOverrideApplied,
      note,
      policyVersion: policy.policyVersion,
    };
    if (this.database?.enabled) {
      return this.database.saveTicket(ticket, idempotencyKey, requestHash, context.actorId ?? 'local-development');
    }
    this.tickets.push(ticket);
    this.idempotentTickets.set(idempotencyKey, { requestHash, ticket });
    return ticket;
  }

  async findExistingTicket(context: AgentRunContext): Promise<ResolutionTicket | undefined> {
    const idempotencyKey = context.idempotencyKey ?? randomUUID();
    const requestHash = this.requestHash(context);
    const cached = this.idempotentTickets.get(idempotencyKey);
    if (cached) {
      if (cached.requestHash !== requestHash) throw new Error('Idempotency key was reused with different request data.');
      return cached.ticket;
    }
    if (this.database?.enabled) {
      return this.database.findTicketByIdempotencyKey(idempotencyKey, requestHash);
    }
    return undefined;
  }

  getTicket(ticketId: string): ResolutionTicket | undefined {
    return this.tickets.find((ticket) => ticket.ticketId === ticketId);
  }

  private withPurchaseDate(order: Order): OrderDetails {
    const purchasedAt = new Date(Date.now() - order.purchaseAgeDays * 24 * 60 * 60 * 1000);
    return {
      ...order,
      purchasedAt: purchasedAt.toISOString(),
      daysSincePurchase: Math.floor((Date.now() - purchasedAt.getTime()) / (24 * 60 * 60 * 1000)),
    };
  }

  private requestHash(context: AgentRunContext): string {
    return createHash('sha256')
      .update(`${context.actorId ?? 'local-development'}\n${context.orderId}\n${context.policy?.policyVersion ?? ''}\n${context.message.trim()}`)
      .digest('hex');
  }

  private assertPolicyDocumentConsistent(): void {
    const returnDays = Number(this.policyText.match(/(?:Return window|Вікно повернення):\s*(\d+)/i)?.[1]);
    const refundLimit = Number(this.policyText.match(/(?:Automatic refund limit|Ліміт автоматичного повернення):\s*\$?([\d.]+)/i)?.[1]);
    const categoryLine = this.policyText.match(/(?:Non-refundable categories|Категорії без повернення):\s*(.+)/i)?.[1] ?? '';
    const categories = categoryLine.split(',').map((item) => item.trim().replace(/[.*_`]/g, '')).filter(Boolean);
    const sameCategories = categories.length === this.refundPolicy.nonRefundableCategories.length
      && categories.every((category) => this.refundPolicy.nonRefundableCategories.includes(category));
    if (returnDays !== this.refundPolicy.maxReturnDays
      || refundLimit !== this.refundPolicy.maxAutoRefundUsd
      || !sameCategories) {
      throw new Error('The human-readable return policy does not match refund-policy.json.');
    }
  }
}

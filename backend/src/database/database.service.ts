import { ConflictException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Order, OrderDetails, OrderSchema, ResolutionTicket } from '../agent/schemas';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) { }

  get enabled(): boolean {
    return Boolean(this.pool);
  }

  async checkReady(): Promise<void> {
    if (!this.pool) throw new Error('Database is not configured.');
    await this.pool.query('SELECT 1');
  }

  async savePromptInjectionEvent(event: {
    eventId: string;
    requestId: string;
    actorSubject: string;
    detectionCode: string;
    inputLength: number;
  }): Promise<void> {
    if (!this.pool) throw new Error('Database is not configured.');
    await this.pool.query(
      `INSERT INTO security_events
         (event_id, event_type, request_id, actor_subject, detection_code, input_length)
       VALUES ($1, 'PROMPT_INJECTION_DETECTED', $2, $3, $4, $5)`,
      [event.eventId, event.requestId, event.actorSubject, event.detectionCode, event.inputLength],
    );
  }

  async findOrder(orderId: string): Promise<OrderDetails | undefined> {
    if (!this.pool) return undefined;
    const result = await this.pool.query<{
      order_id: string;
      customer_name: string;
      item_name: string;
      category: string;
      total_amount_usd: string;
      purchased_at: Date;
    }>(
      `SELECT order_id, customer_name, item_name, category, total_amount_usd, purchased_at
       FROM orders WHERE order_id = upper($1)`,
      [orderId],
    );
    const row = result.rows[0];
    return row ? this.orderFromRow(row) : undefined;
  }

  async listOrders(limit = 100): Promise<OrderDetails[]> {
    if (!this.pool) return [];
    const result = await this.pool.query<{
      order_id: string;
      customer_name: string;
      item_name: string;
      category: string;
      total_amount_usd: string;
      purchased_at: Date;
    }>(
      `SELECT order_id, customer_name, item_name, category, total_amount_usd, purchased_at
       FROM orders ORDER BY purchased_at DESC LIMIT $1`,
      [Math.min(Math.max(Math.floor(limit), 1), 100)],
    );
    return result.rows.map((row) => this.orderFromRow(row));
  }

  async onModuleInit(): Promise<void> {
    const connectionString = this.config.get<string>('DATABASE_URL')?.trim();
    if (!connectionString) return;

    this.pool = new Pool({
      connectionString,
      max: Number(this.config.get<string>('DATABASE_POOL_MAX', '10')),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: Number(this.config.get<string>('DATABASE_STATEMENT_TIMEOUT_MS', '5000')),
      query_timeout: Number(this.config.get<string>('DATABASE_QUERY_TIMEOUT_MS', '7000')),
      application_name: 'bulls-media-agent-api',
      ssl: this.config.get<string>('DATABASE_SSL') === 'true'
        ? { rejectUnauthorized: true }
        : undefined,
    });
    this.pool.on('error', () => Logger.error('Unexpected error from an idle PostgreSQL connection.', 'DatabaseService'));

    await Promise.all([
      this.pool.query('SELECT 1 FROM resolution_tickets LIMIT 0'),
      this.pool.query('SELECT 1 FROM orders LIMIT 0'),
      this.pool.query('SELECT 1 FROM security_events LIMIT 0'),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async saveTicket(ticket: ResolutionTicket, idempotencyKey: string, requestHash: string, actorId: string): Promise<ResolutionTicket> {
    if (!this.pool) throw new Error('Database is not configured.');
    type TicketRow = {
      ticket_id: string;
      order_id: string;
      status: ResolutionTicket['status'];
      refund_amount_usd: string | null;
      reason_code: string;
      deterministic_override_applied: boolean;
      note: string;
      policy_version: string;
    };
    const result = await this.pool.query<TicketRow>(
      `INSERT INTO resolution_tickets
         (ticket_id, order_id, status, refund_amount_usd, reason_code,
          deterministic_override_applied, note, idempotency_key, request_hash, actor_subject, policy_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING ticket_id, order_id, status, refund_amount_usd, reason_code,
                 deterministic_override_applied, note, policy_version`,
      [ticket.ticketId, ticket.orderId, ticket.status, ticket.refundAmountUsd,
      ticket.reasonCode, ticket.deterministicOverrideApplied, ticket.note, idempotencyKey, requestHash, actorId, ticket.policyVersion],
    );

    if (result.rows[0]) return this.fromRow(result.rows[0]);
    const existing = await this.pool.query<TicketRow & { request_hash: string }>(
      `SELECT ticket_id, order_id, status, refund_amount_usd, reason_code,
              deterministic_override_applied, note, policy_version, request_hash
       FROM resolution_tickets WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== requestHash) {
      throw new ConflictException('Idempotency key was already used for a different request.');
    }
    return this.fromRow(row);
  }

  async findTicketByIdempotencyKey(idempotencyKey: string, requestHash: string): Promise<ResolutionTicket | undefined> {
    if (!this.pool) return undefined;
    const result = await this.pool.query<{
      ticket_id: string;
      order_id: string;
      status: ResolutionTicket['status'];
      refund_amount_usd: string | null;
      reason_code: string;
      deterministic_override_applied: boolean;
      note: string;
      policy_version: string;
      request_hash: string;
    }>(
      `SELECT ticket_id, order_id, status, refund_amount_usd, reason_code,
              deterministic_override_applied, note, policy_version, request_hash
       FROM resolution_tickets WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (row.request_hash !== requestHash) {
      throw new ConflictException('Idempotency key was already used for a different request.');
    }
    return this.fromRow(row);
  }

  private fromRow(row: {
    ticket_id: string;
    order_id: string;
    status: ResolutionTicket['status'];
    refund_amount_usd: string | null;
    reason_code: string;
    deterministic_override_applied: boolean;
    note: string;
    policy_version: string;
  }): ResolutionTicket {
    return {
      ticketId: row.ticket_id,
      orderId: row.order_id,
      status: row.status,
      refundAmountUsd: row.refund_amount_usd === null ? null : Number(row.refund_amount_usd),
      reasonCode: row.reason_code,
      deterministicOverrideApplied: row.deterministic_override_applied,
      note: row.note,
      policyVersion: row.policy_version,
    };
  }

  private orderFromRow(row: {
    order_id: string;
    customer_name: string;
    item_name: string;
    category: string;
    total_amount_usd: string;
    purchased_at: Date;
  }): OrderDetails {
    const purchasedAt = new Date(row.purchased_at);
    const now = new Date();
    const purchasedDay = Date.UTC(purchasedAt.getUTCFullYear(), purchasedAt.getUTCMonth(), purchasedAt.getUTCDate());
    const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (purchasedAt.getTime() > now.getTime() + 60_000) {
      throw new Error('The order source returned a future purchase date.');
    }
    const daysSincePurchase = Math.floor((currentDay - purchasedDay) / 86_400_000);
    const order: Order = OrderSchema.parse({
      orderId: row.order_id,
      customerName: row.customer_name,
      itemName: row.item_name,
      category: row.category,
      totalAmountUsd: Number(row.total_amount_usd),
      purchaseAgeDays: daysSincePurchase,
    });
    return { ...order, purchasedAt: purchasedAt.toISOString(), daysSincePurchase };
  }
}

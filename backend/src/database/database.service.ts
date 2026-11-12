import { ConflictException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Order, OrderDetails, OrderSchema, ResolutionStatus, ResolutionTicket } from '../agent/schemas';
import { PrismaService } from './prisma.service';

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return this.prisma.enabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await Promise.all([
      this.prisma.order.findFirst({ select: { orderId: true } }),
      this.prisma.resolutionTicket.findFirst({ select: { ticketId: true } }),
      this.prisma.securityEvent.findFirst({ select: { eventId: true } }),
    ]);
  }

  async checkReady(): Promise<void> {
    if (!this.enabled) throw new Error('Database is not configured.');
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async savePromptInjectionEvent(event: {
    eventId: string;
    requestId: string;
    actorSubject: string;
    detectionCode: string;
    inputLength: number;
  }): Promise<void> {
    if (!this.enabled) throw new Error('Database is not configured.');
    await this.prisma.securityEvent.create({
      data: {
        eventId: event.eventId,
        eventType: 'PROMPT_INJECTION_DETECTED',
        requestId: event.requestId,
        actorSubject: event.actorSubject,
        detectionCode: event.detectionCode,
        inputLength: event.inputLength,
      },
    });
  }

  async findOrder(orderId: string): Promise<OrderDetails | undefined> {
    if (!this.enabled) return undefined;
    const row = await this.prisma.order.findUnique({ where: { orderId: orderId.toUpperCase() } });
    return row ? this.orderFromRow(row) : undefined;
  }

  async listOrders(limit = 100): Promise<OrderDetails[]> {
    if (!this.enabled) return [];
    const rows = await this.prisma.order.findMany({
      orderBy: { purchasedAt: 'desc' },
      take: Math.min(Math.max(Math.floor(limit), 1), 100),
    });
    return rows.map((row) => this.orderFromRow(row));
  }

  async saveTicket(
    ticket: ResolutionTicket,
    idempotencyKey: string,
    requestHash: string,
    actorId: string,
  ): Promise<ResolutionTicket> {
    if (!this.enabled) throw new Error('Database is not configured.');
    try {
      const row = await this.prisma.resolutionTicket.create({
        data: {
          ticketId: ticket.ticketId,
          orderId: ticket.orderId,
          status: ticket.status,
          refundAmountUsd: ticket.refundAmountUsd,
          reasonCode: ticket.reasonCode,
          deterministicOverrideApplied: ticket.deterministicOverrideApplied,
          note: ticket.note,
          idempotencyKey,
          requestHash,
          actorSubject: actorId,
          policyVersion: ticket.policyVersion,
        },
      });
      return this.ticketFromRow(row);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.findTicketByIdempotencyKey(idempotencyKey, requestHash);
      if (!existing) throw new ConflictException('Idempotency key was already used for a different request.');
      return existing;
    }
  }

  async findTicketByIdempotencyKey(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ResolutionTicket | undefined> {
    if (!this.enabled) return undefined;
    const row = await this.prisma.resolutionTicket.findUnique({ where: { idempotencyKey } });
    if (!row) return undefined;
    if (row.requestHash !== requestHash) {
      throw new ConflictException('Idempotency key was already used for a different request.');
    }
    return this.ticketFromRow(row);
  }

  private ticketFromRow(row: {
    ticketId: string;
    orderId: string;
    status: string;
    refundAmountUsd: Prisma.Decimal | null;
    reasonCode: string;
    deterministicOverrideApplied: boolean;
    note: string;
    policyVersion: string;
  }): ResolutionTicket {
    return {
      ticketId: row.ticketId,
      orderId: row.orderId,
      status: row.status as ResolutionStatus,
      refundAmountUsd: row.refundAmountUsd?.toNumber() ?? null,
      reasonCode: row.reasonCode,
      deterministicOverrideApplied: row.deterministicOverrideApplied,
      note: row.note,
      policyVersion: row.policyVersion,
    };
  }

  private orderFromRow(row: {
    orderId: string;
    customerName: string;
    itemName: string;
    category: string;
    totalAmountUsd: Prisma.Decimal;
    purchasedAt: Date;
  }): OrderDetails {
    const purchasedAt = new Date(row.purchasedAt);
    const now = new Date();
    const purchasedDay = Date.UTC(purchasedAt.getUTCFullYear(), purchasedAt.getUTCMonth(), purchasedAt.getUTCDate());
    const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (purchasedAt.getTime() > now.getTime() + 60_000) {
      throw new Error('The order source returned a future purchase date.');
    }
    const daysSincePurchase = Math.floor((currentDay - purchasedDay) / 86_400_000);
    const order: Order = OrderSchema.parse({
      orderId: row.orderId,
      customerName: row.customerName,
      itemName: row.itemName,
      category: row.category,
      totalAmountUsd: row.totalAmountUsd.toNumber(),
      purchaseAgeDays: daysSincePurchase,
    });
    return { ...order, purchasedAt: purchasedAt.toISOString(), daysSincePurchase };
  }
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { OrdersDatasetSchema } from '../src/agent/schemas';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function seed(): Promise<void> {
  const datasetPath = join(process.cwd(), 'src', 'data', 'orders.json');
  const orders = OrdersDatasetSchema.parse(JSON.parse(readFileSync(datasetPath, 'utf8')));

  for (const order of orders) {
    const purchasedAt = new Date(Date.now() - order.purchaseAgeDays * 86_400_000);
    await prisma.order.upsert({
      where: { orderId: order.orderId },
      create: {
        orderId: order.orderId,
        customerName: order.customerName,
        itemName: order.itemName,
        category: order.category,
        totalAmountUsd: order.totalAmountUsd,
        purchasedAt,
      },
      update: {
        customerName: order.customerName,
        itemName: order.itemName,
        category: order.category,
        totalAmountUsd: order.totalAmountUsd,
        purchasedAt,
        updatedAt: new Date(),
      },
    });
  }

  process.stdout.write(`Seeded ${orders.length} demo orders.\n`);
}

seed()
  .catch((error: unknown) => {
    process.stderr.write(`Database seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

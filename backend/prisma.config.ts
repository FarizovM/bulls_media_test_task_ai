import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

config({ path: resolve(__dirname, '../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL
      ?? process.env.DATABASE_URL
      ?? 'postgresql://localhost:5432/bulls_media',
  },
});

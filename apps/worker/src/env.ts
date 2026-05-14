import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

config({ path: resolve(process.cwd(), '../../.env.local') });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  CHANNEX_API_URL: z.string().url(),
  CHANNEX_API_KEY: z.string().min(1),
  CHANNEX_WEBHOOK_SECRET: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:5173'),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;

import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATA_DIR: z.string().min(1).default('./data'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = {
  port: number;
  host: string;
  dataDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  dbPath: string;
  backupDir: string;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  const { PORT, HOST, DATA_DIR, LOG_LEVEL } = parsed.data;
  return {
    port: PORT,
    host: HOST,
    dataDir: DATA_DIR,
    logLevel: LOG_LEVEL,
    dbPath: join(DATA_DIR, 'promus.db'),
    backupDir: join(DATA_DIR, 'backups'),
  };
}

// scripts/migrate.ts
// Lightweight migration runner for local / CI usage against Supabase Postgres.
// Strategy: ensure a migrations table, list local files, apply those not yet recorded.
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { logger } from '../backend/logger.js';
// Load environment variables (so SUPABASE_DB_URL is available when invoked via npm scripts)
import * as dotenv from 'dotenv';
dotenv.config();
// Prefer IPv4 addresses first; helps when IPv6 route is unreachable (ENETUNREACH)
import dns from 'dns';
try {
  // Node 18+ supports setDefaultResultOrder
  (dns as any).setDefaultResultOrder?.('ipv4first');
} catch {}

interface MigrationResult { file: string; statements: number; ms: number; }

function splitStatements(sql: string): string[] {
  // Simple splitter: ignores semicolons inside $$...$$ blocks.
  const parts: string[] = [];
  let current = '';
  let inDollar = false;
  // Track dollar tag if present (e.g., $func$)
  let dollarTag: string | null = null;
  const lines = sql.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const dollarMatch = trimmed.match(/^\$(\w*)\$/);
    if (dollarMatch) {
      if (!inDollar) {
        inDollar = true; dollarTag = dollarMatch[0];
      } else if (dollarTag === dollarMatch[0]) {
        inDollar = false; dollarTag = null;
      }
    }
    current += line + '\n';
    if (!inDollar && trimmed.endsWith(';')) {
      parts.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(p => p && !/^--/.test(p));
}

async function getClient(): Promise<Client> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    logger.error('Environment SUPABASE_DB_URL not set. Cannot run migrations.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e: any) {
    if (e?.code === 'ENETUNREACH') {
      logger.error({ hostUrl: url, err: e.message }, 'Network unreachable connecting to database (likely IPv6-only direct connection).');
      console.error('\nHint: Your environment appears IPv4-only. The Supabase Direct connection can be IPv6-only. Copy the Session pooler (IPv4 compatible) connection string from the Supabase dashboard and set SUPABASE_DB_URL to that instead for migrations.');
    }
    throw e;
  }
  return client;
}

async function ensureMigrationsTablePg(client: Client) {
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    filename TEXT UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function loadAppliedPg(client: Client): Promise<Set<string>> {
  const res = await client.query('SELECT filename FROM _migrations');
  return new Set(res.rows.map((r: any) => r.filename));
}

async function applyMigrationPg(client: Client, file: string, sql: string): Promise<MigrationResult> {
  const start = Date.now();
  const stmts = splitStatements(sql);
  try {
    await client.query('BEGIN');
    for (const stmt of stmts) {
      if (stmt.trim()) {
        await client.query(stmt);
      }
    }
    await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    return { file, statements: stmts.length, ms: Date.now() - start };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const migrationsDir = path.resolve('migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.error({ migrationsDir }, 'Migrations directory missing');
    process.exit(1);
  }
  const files = fs.readdirSync(migrationsDir).filter(f => /\d+.*\.sql$/.test(f)).sort();
  const client = await getClient();
  try {
    await ensureMigrationsTablePg(client);
    const applied = await loadAppliedPg(client);
    const pending = files.filter(f => !applied.has(f));
    if (!pending.length) {
      console.log('No pending migrations.');
      return;
    }
    console.log('Pending migrations:', pending.join(', '));
    for (const file of pending) {
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, 'utf8');
      try {
        const result = await applyMigrationPg(client, file, sql);
        logger.info({ file: result.file, statements: result.statements, ms: result.ms }, 'migration.applied');
      } catch (e: any) {
        logger.error({ file, err: e?.message }, 'migration.failed');
        process.exit(1);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  logger.error({ err }, 'migrations.unhandled');
  process.exit(1);
});

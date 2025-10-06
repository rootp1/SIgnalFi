import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

/*
  Creates a small key-value state table used by reconciliation worker.
  Idempotent: safe to re-run. Records a migration row.
*/
async function main() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL or SUPABASE_DB_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Ensure migrations table exists (lightweight guard)
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (filename text primary key, applied_at timestamptz default now())`);

    // Create _state if absent
    await client.query(`CREATE TABLE IF NOT EXISTS _state (
      key text primary key,
      value text,
      updated_at timestamptz default now()
    )`);

    // Add helpful index on executed_trades.onchain_verified if missing
    await client.query(`CREATE INDEX IF NOT EXISTS idx_executed_trades_onchain_verified ON executed_trades(onchain_verified)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_executed_trades_intent_hash ON executed_trades(intent_hash)`);

    await client.query(`INSERT INTO _migrations (filename) VALUES ('0020_step2_state_table.sql') ON CONFLICT DO NOTHING`);
    console.log('Step2 state table + indexes ensured.');
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

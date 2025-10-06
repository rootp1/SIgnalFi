import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL env required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='executed_trades'");
    const have = new Set(cols.rows.map(r => r.column_name));
    async function add(sql: string) { await client.query(sql); }
    if (!have.has('onchain_verified')) await add('ALTER TABLE executed_trades ADD COLUMN onchain_verified BOOLEAN');
    if (!have.has('onchain_event_ts')) await add('ALTER TABLE executed_trades ADD COLUMN onchain_event_ts BIGINT');
    if (!have.has('follower_count')) await add('ALTER TABLE executed_trades ADD COLUMN follower_count INT');
    await client.query('CREATE INDEX IF NOT EXISTS idx_executed_trades_onchain_verified ON executed_trades(onchain_verified)');
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0016_phase5_reconciliation.sql') ON CONFLICT DO NOTHING`);
    console.log('Phase 5 reconciliation columns ensured.');
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

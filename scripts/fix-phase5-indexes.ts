import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL or SUPABASE_DB_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE INDEX IF NOT EXISTS idx_executed_trades_status_next_attempt ON executed_trades(status, next_attempt_at)`);
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0017_phase5_status_next_attempt_index.sql') ON CONFLICT DO NOTHING`);
    console.log('Index ensured.');
  } finally { await client.end(); }
}

main().catch(e => { console.error(e); process.exit(1); });

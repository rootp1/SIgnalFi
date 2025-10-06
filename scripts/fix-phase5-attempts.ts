import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL or SUPABASE_DB_URL required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='executed_trades'");
    const have = new Set(cols.rows.map(r => r.column_name));
    if (!have.has('attempts')) await client.query('ALTER TABLE executed_trades ADD COLUMN attempts INT');
    if (!have.has('next_attempt_at')) await client.query('ALTER TABLE executed_trades ADD COLUMN next_attempt_at TIMESTAMPTZ');
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0018_phase5_attempts_columns.sql') ON CONFLICT DO NOTHING`);
    console.log('Attempts columns ensured.');
  } finally { await client.end(); }
}

main().catch(e => { console.error(e); process.exit(1); });

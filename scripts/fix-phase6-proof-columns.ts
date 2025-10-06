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
    if (!have.has('onchain_event_version')) {
      await client.query('ALTER TABLE executed_trades ADD COLUMN onchain_event_version BIGINT');
    }
    if (!have.has('onchain_event_tx_hash')) {
      await client.query('ALTER TABLE executed_trades ADD COLUMN onchain_event_tx_hash TEXT');
      await client.query('CREATE INDEX IF NOT EXISTS idx_executed_trades_event_tx_hash ON executed_trades(onchain_event_tx_hash)');
    }
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0019_phase6_proof_columns.sql') ON CONFLICT DO NOTHING`);
    console.log('Phase6 proof columns ensured.');
  } finally { await client.end(); }
}

main().catch(e => { console.error(e); process.exit(1); });

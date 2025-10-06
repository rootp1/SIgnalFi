import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('DATABASE_URL env required');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Ensure status enum values or at least allow free-form text (assumed TEXT already)
    // Add index for new statuses filtering if absent.
    await client.query(`CREATE INDEX IF NOT EXISTS idx_executed_trades_status ON executed_trades(status)`);
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0015_phase5_onchain.sql') ON CONFLICT DO NOTHING`);
    console.log('Phase 5 on-chain execution prerequisites ensured.');
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

// scripts/fix-phase4-followers.ts
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import dns from 'dns';
(dns as any).setDefaultResultOrder?.('ipv4first');
dotenv.config();

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) { console.error('SUPABASE_DB_URL not set'); process.exit(1); }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='executed_trades'");
    const names = cols.rows.map(r=>r.column_name);
    if (!names.includes('followers_snapshot')) {
      console.log('Adding followers_snapshot column');
      await client.query('ALTER TABLE executed_trades ADD COLUMN followers_snapshot JSONB');
      await client.query('CREATE INDEX idx_executed_trades_followers_snapshot ON executed_trades USING gin (followers_snapshot)');
    } else {
      console.log('followers_snapshot already exists');
    }
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0014_executed_trades_followers.sql') ON CONFLICT DO NOTHING`);
    console.log('Phase 4 followers snapshot ensured.');
  } catch (e: any) {
    console.error('Phase 4 fix error:', e.message, e.code); process.exit(1);
  } finally { await client.end(); }
}

main();
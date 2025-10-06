// scripts/fix-phase3-columns.ts
// Manually ensure executed_trades Phase 3 columns exist and mark migrations 0012 & 0013 applied.
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
    async function add(col: string, sql: string) {
      if (!names.includes(col)) { console.log('Adding column', col); await client.query(sql); }
    }
    await add('intent_hash', 'ALTER TABLE executed_trades ADD COLUMN intent_hash TEXT');
    await add('anchor_id', 'ALTER TABLE executed_trades ADD COLUMN anchor_id BIGINT');
    await add('payload_hash', 'ALTER TABLE executed_trades ADD COLUMN payload_hash TEXT');
    await add('plan_hash', 'ALTER TABLE executed_trades ADD COLUMN plan_hash TEXT');
    await client.query('CREATE INDEX IF NOT EXISTS idx_executed_trades_intent_hash ON executed_trades(intent_hash)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_executed_trades_anchor_id ON executed_trades(anchor_id)');
    // Mark migrations applied
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0012_trade_intents_pending_exec_fn.sql') ON CONFLICT DO NOTHING`);
    await client.query(`INSERT INTO _migrations (filename) VALUES ('0013_executed_trades_extend.sql') ON CONFLICT DO NOTHING`);
    console.log('Phase 3 columns ensured.');
  } catch (e: any) {
    console.error('Phase 3 fix error:', e.message, e.code); process.exit(1);
  } finally {
    await client.end();
  }
}

main();
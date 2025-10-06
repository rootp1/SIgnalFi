// scripts/fix-executed-trades-table.ts
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
    const exists = await client.query("SELECT to_regclass('public.executed_trades') AS reg");
    if (!exists.rows[0].reg) {
      console.log('Creating executed_trades table...');
      await client.query(`CREATE TABLE executed_trades (
        id BIGSERIAL PRIMARY KEY,
        trade_intent_id BIGINT REFERENCES trade_intents(id) ON DELETE CASCADE,
        signal_id BIGINT REFERENCES signals(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        tx_hash TEXT,
        size_value NUMERIC,
        slippage_bps INTEGER,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        executed_at TIMESTAMPTZ
      )`);
      await client.query(`CREATE UNIQUE INDEX idx_executed_trades_intent ON executed_trades(trade_intent_id)`);
      await client.query(`CREATE INDEX idx_executed_trades_status ON executed_trades(status)`);
    } else {
      console.log('executed_trades table already exists');
    }
    await client.query(`INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, ['0011_executed_trades.sql']);
    console.log('Migration recorded.');
  } catch (e: any) {
    console.error('Error ensuring executed_trades table:', e.message, e.code);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
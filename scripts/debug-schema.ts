// scripts/debug-schema.ts
// Prints the column definitions for anchored_signals to diagnose partial migration application.
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import dns from 'dns';
(dns as any).setDefaultResultOrder?.('ipv4first');
dotenv.config();

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error('SUPABASE_DB_URL not set');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'anchored_signals'
    ORDER BY ordinal_position
  `);
  console.table(res.rows);
  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'anchored_signals'
  `);
  console.table(idx.rows);
  try {
    const test = await client.query('SELECT attempts FROM anchored_signals LIMIT 1');
    console.log('attempts column selectable, sample value(s):', test.rows.map(r=>r.attempts));
  } catch (e: any) {
    console.error('Selecting attempts failed:', (e as any).message);
  }
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });

// scripts/fix-attempts-column.ts
// Force-create the missing 'attempts' column on anchored_signals if absent.
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
  try {
    const check = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name='anchored_signals' AND column_name='attempts'");
    if (check.rowCount) {
      console.log("'attempts' column already present");
    } else {
      console.log("Adding 'attempts' column...");
      await client.query("ALTER TABLE anchored_signals ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
      console.log("Column added.");
    }
    const verify = await client.query("SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name='anchored_signals' AND column_name IN ('attempts','last_error','next_attempt_at')");
    console.table(verify.rows);
  } catch (e: any) {
    console.error('Error adding attempts column:', e.message, e.code);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
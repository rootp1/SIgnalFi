// scripts/fix-verification-columns.ts
// Ensures verified_at & verification_status columns exist on anchored_signals and records migration 0009 as applied.
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
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='anchored_signals'`);
    const names = cols.rows.map(r=>r.column_name);
    if (!names.includes('verified_at')) {
      console.log('Adding verified_at column');
      await client.query(`ALTER TABLE anchored_signals ADD COLUMN verified_at TIMESTAMPTZ`);
    } else {
      console.log('verified_at already exists');
    }
    if (!names.includes('verification_status')) {
      console.log('Adding verification_status column');
      await client.query(`ALTER TABLE anchored_signals ADD COLUMN verification_status TEXT DEFAULT 'unverified'`);
    } else {
      console.log('verification_status already exists');
    }
    // Ensure indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anchored_signals_verification_status ON anchored_signals(verification_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_anchored_signals_verified_at ON anchored_signals(verified_at)`);
    // Record migration as applied
    await client.query(`INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, ['0009_anchor_verification.sql']);
    console.log('Columns & indexes ensured. Migration recorded.');
    const verify = await client.query(`SELECT column_name, column_default FROM information_schema.columns WHERE table_name='anchored_signals' AND column_name IN ('verified_at','verification_status')`);
    console.table(verify.rows);
  } catch (e: any) {
    console.error('Error ensuring verification columns:', e.message, e.code);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
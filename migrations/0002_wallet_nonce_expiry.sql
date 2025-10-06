-- 0002_wallet_nonce_expiry.sql
-- Adds nonce expiry support and index for quick cleanup.
ALTER TABLE user_wallets ADD COLUMN IF NOT EXISTS nonce_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_user_wallets_nonce_expires_at ON user_wallets(nonce_expires_at);

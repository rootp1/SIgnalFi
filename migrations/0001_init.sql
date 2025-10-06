-- 0001_init.sql
-- Core schema for SignalFi
-- Idempotent-ish: use CREATE TABLE IF NOT EXISTS where safe; for constraints use DO blocks if needed (Postgres specific)

-- Users are identified primarily by Telegram user id; optional username captured for convenience.
CREATE TABLE IF NOT EXISTS users (
  telegram_user_id BIGINT PRIMARY KEY,
  telegram_username TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet links per user (support multi-wallet). A single wallet can be linked by multiple telegram users? Likely no, so put unique on address.
CREATE TABLE IF NOT EXISTS user_wallets (
  id BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  address TEXT,
  nonce TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(address),
  UNIQUE(telegram_user_id)  -- If only one wallet per user. Remove if supporting multiple.
);

-- Traders: subset of users who broadcast signals (could just flag in users, but separate gives flexibility).
CREATE TABLE IF NOT EXISTS traders (
  telegram_user_id BIGINT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  display_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follow relationships (follower -> trader)
CREATE TABLE IF NOT EXISTS follows (
  id BIGSERIAL PRIMARY KEY,
  follower_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  trader_id BIGINT NOT NULL REFERENCES traders(telegram_user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, trader_id)
);

-- User settings (e.g., default trade amount, risk multiplier, notification preferences)
CREATE TABLE IF NOT EXISTS user_settings (
  telegram_user_id BIGINT PRIMARY KEY REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  trade_amount_numeric NUMERIC(36, 18),
  risk_multiplier NUMERIC(10,4) DEFAULT 1.0,
  notify_signals BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signals broadcast by traders.
CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  trader_id BIGINT NOT NULL REFERENCES traders(telegram_user_id) ON DELETE CASCADE,
  payload JSONB NOT NULL, -- Flexible structure: {symbol, side, size, ..}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Signal deliveries (audit of which follower received which signal and when)
CREATE TABLE IF NOT EXISTS signal_deliveries (
  id BIGSERIAL PRIMARY KEY,
  signal_id BIGINT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  follower_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'delivered', -- delivered | failed | queued
  UNIQUE(signal_id, follower_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_follows_trader ON follows(trader_id);
CREATE INDEX IF NOT EXISTS idx_signals_trader ON signals(trader_id);
CREATE INDEX IF NOT EXISTS idx_signal_deliveries_signal ON signal_deliveries(signal_id);

-- Basic view: follower counts per trader
CREATE OR REPLACE VIEW trader_stats AS
SELECT t.telegram_user_id AS trader_id,
       COUNT(f.id) AS follower_count,
       MAX(s.created_at) AS last_signal_at
FROM traders t
LEFT JOIN follows f ON f.trader_id = t.telegram_user_id
LEFT JOIN signals s ON s.trader_id = t.telegram_user_id
GROUP BY t.telegram_user_id;

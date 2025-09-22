-- Create the positions table
CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(telegram_id),
  token VARCHAR(10) NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  action VARCHAR(4) NOT NULL, -- 'buy' or 'sell'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add an index on user_id for faster lookups
CREATE INDEX idx_positions_user_id ON positions(user_id);

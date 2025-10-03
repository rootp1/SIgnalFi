// Shared domain types for SignalFi
// Keep these in sync with DB schema and API contracts.

export interface User {
  telegram_user_id: number;
  telegram_username?: string | null;
  created_at?: string;
}

export interface UserWallet {
  id: number;
  telegram_user_id: number;
  address: string | null;
  nonce: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface Trader {
  telegram_user_id: number;
  display_name?: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface Follow {
  id: number;
  follower_id: number;
  trader_id: number;
  created_at: string;
}

export interface UserSettings {
  telegram_user_id: number;
  trade_amount_numeric?: string | null; // Represent numeric as string to avoid precision loss
  risk_multiplier: string; // NUMERIC -> string representation
  notify_signals: boolean;
  updated_at: string;
}

export interface Signal {
  id: number;
  trader_id: number;
  payload: any; // TODO: refine shape (SignalPayload)
  created_at: string;
}

export interface SignalDelivery {
  id: number;
  signal_id: number;
  follower_id: number;
  delivered_at: string;
  status: 'delivered' | 'failed' | 'queued';
}

export interface TraderStatsView {
  trader_id: number;
  follower_count: number;
  last_signal_at: string | null;
}

// API DTOs
export interface FollowRequestDTO {
  userId: number; // follower telegram id
  traderToFollow: number; // trader telegram id
}

export interface SettingsUpdateDTO {
  userId: number;
  tradeAmount?: string; // user provided amount; convert -> numeric
  riskMultiplier?: string;
  notifySignals?: boolean;
}

export interface WalletChallengeRequestDTO {
  telegramUserId: number;
}

export interface WalletVerifyRequestDTO {
  telegramUserId: number;
  address: string;
  signature: string;
}

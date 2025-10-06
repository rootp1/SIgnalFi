# SignalFi

Early-stage project that connects Telegram users (followers) with trader signal broadcasters, with optional wallet verification and on-chain anchoring / execution reconciliation (Aptos).

## Stack
- Telegram bot (grammy)
- Express backend (TypeScript)
- Supabase (Postgres + auth/edge features) for persistence
- Ethers (signature verification)

## Current Features
- Wallet linking flow (challenge → verify → status)
- Follow / Unfollow + user settings persistence
- Signal ingestion with intent extraction & canonical hashing
- On-chain anchoring of signal payload hash + verification endpoint
- Trade intents → execution rows (simulation or on-chain) with retry/backoff
- Versioned vault events (v2 includes plan hash + schema version)
- Reconciliation worker (on-chain event version + tx hash + plan hash mismatch detection)
- Unified full signal view endpoint `/api/signal/:id/full`
- Mock slippage injection (random or fixed bps) for executions
- Metrics endpoint `/api/metrics` (counts + slippage)
- Telegram bot commands: /start, /follow, /connectwallet, /verifywallet, /walletstatus

## Getting Started

1. Copy environment file
```bash
cp .env.example .env
```
2. Fill in Telegram bot token and Supabase credentials.
3. Apply DB migrations (see below).
4. Install dependencies
```bash
npm install
```
5. Run backend & bot (two terminals or use dev script)
```bash
npm run start:backend
npm run start:bot
```
6. (Optional) Enable on-chain execution + v2 events + mock slippage
## Testing
Smoke (basic REST flow):
```bash
npm run test:e2e
```
Anchor flow (on-chain anchoring only):
```bash
npm run test:anchor-e2e
```
Full pipeline (signal -> anchor -> intent -> execution -> reconciliation):
```bash
EXECUTION_MODE=simulation npm run test:full-e2e
# or on-chain (requires keys & deployed modules)
EXECUTION_MODE=onchain VAULT_EVENT_V2=1 npm run test:full-e2e
```
```bash
export EXECUTION_MODE=onchain
export VAULT_EVENT_V2=1
export MOCK_SLIPPAGE=1
```

## Database Migrations
Core schema seeded via files in `migrations/`. Apply in order (example):
```bash
for f in migrations/*.sql; do echo "Applying $f"; psql "$SUPABASE_DB_URL" -f "$f"; done
```
Idempotent fix scripts (column additions, indexes) live in `scripts/` (`npm run fix:*`).

## Roadmap (Upcoming)
1. Telegram advanced commands (recent executions, metrics summary)
2. Integration test harness + CI
3. Dockerization & deployment templates
4. Structured metrics (Prometheus) & tracing
5. Pagination & auth hardening

## Table Summary (Selected)
- users / traders / follows / user_settings
- signals / trade_intents / executed_trades
- anchored_signals (on-chain anchor lifecycle)
- _migrations (applied scripts) / _state (worker cursors)

Indexes provided via fix scripts for performance (e.g. executed_trades intent / onchain columns).

## Key API Endpoints
Health: `GET /api/health`
Wallet: `POST /api/wallet/challenge`, `POST /api/wallet/verify`, `GET /api/wallet/status/:id`
Follow: `POST /api/follow`, `POST /api/unfollow`, `GET /api/follows/:id`
Settings: `POST /api/settings`, `GET /api/settings/:id`
Signal: `POST /api/signal`, `GET /api/signals`, `GET /api/signal/:id/full`, `GET /api/signal/:id/hash`
Trade Intents: `GET /api/trade-intents/recent`, `GET /api/trade-intent/:signalId`
Executions: `GET /api/executed-trades/recent`, `GET /api/executed-trade/:id`, `GET /api/executed-trade/:id/verify`
Anchors: `GET /api/anchor/:signalId`, `GET /api/anchor/:signalId/verify`, `GET /api/anchors/recent`
On-chain Trader: `POST /api/trader/onchain/register`, `GET /api/trader/onchain/:traderId/next-seq`, `GET /api/trader/:traderId/onchain/status`
Metrics: `GET /api/metrics`

## Contributing
Draft stage—open issues for proposed schema or API changes.

## Security Notes
- Service role key should only run on backend (never in bot client if deployed separately).
- Nonce has expiration; clients must refresh after timeout.
- Keep APTOS_PRIVATE_KEY secret; rotate if leaked.
- Consider restricting metrics in production or moving to authenticated path.

## License
MIT (placeholder)

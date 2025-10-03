# SignalFi

Early-stage project that connects Telegram users (followers) with trader signal broadcasters, with optional wallet verification.

## Stack
- Telegram bot (grammy)
- Express backend (TypeScript)
- Supabase (Postgres + auth/edge features) for persistence
- Ethers (signature verification)

## Current Features
- Wallet linking flow (challenge → verify → status)
- Basic follow/settings/signal endpoint placeholders
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

## Database Migrations
Currently manual SQL in `migrations/`. Apply using Supabase SQL editor or `psql`:
```bash
psql "$SUPABASE_DB_URL" -f migrations/0001_init.sql
```
(You may need to create a direct connection string with service role.)

## Roadmap (Next Steps)
- Implement persistence for follow/settings endpoints
- Add signal creation & broadcast distribution
- Add Zod validation & structured error responses
- Introduce logging (pino) + rate limiting
- Add tests & CI pipeline
- Dockerize

## Table Summary
See `migrations/0001_init.sql` for schema. Core tables: users, user_wallets, traders, follows, user_settings, signals, signal_deliveries.

## Contributing
Draft stage—open issues for proposed schema or API changes.

## Security Notes
- Service role key should only run on backend (never in bot client if deployed separately).
- Nonce should expire (future enhancement).

## License
MIT (placeholder)

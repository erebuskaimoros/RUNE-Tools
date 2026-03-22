# Session 1 - Rapid Swaps Dashboard: Full Stack Build and Deploy

> Date: 2026-03-22
> Focus: Deploy, redesign, and harden the Rapid Swaps dashboard with real-time WebSocket monitoring

## Summary

Built and deployed the Rapid Swaps dashboard end-to-end: deployed Supabase backend (DB migrations, edge functions, GitHub Actions scheduler), fixed SPA routing for the `/boonetools/` base path, redesigned the UI with a terminal/Bloomberg aesthetic, tightened the rapid swap filter to only count completed swaps with `interval=0` and `quantity > 1`, and built a real-time WebSocket listener that connects to THORChain's Tendermint RPC to catch rapid swaps as they happen instead of relying on 5-minute polling.

## Work Done

- Deployed Supabase DB migration (003_rapid_swaps_schema, 004_blocks_used), edge functions (rapid-swaps, rapid-swaps-scheduler), and set GitHub repo secrets
- Pushed workflow to fork/main so GitHub Actions cron scheduler activates
- Fixed SPA routing: added `BASE_PATH` support to App.svelte for `/boonetools/` subpath deployment
- Added Midgard endpoint fallback chain: thorchain.network -> liquify -> ninerealms
- Rebranded from RUNE Tools to BOONE Tools (display text, titles, footer)
- Removed Desktop App tile and all other app tiles — site is now single-purpose Rapid Swaps dashboard
- Redesigned UI: terminal/Bloomberg aesthetic with JetBrains Mono, black background, green/amber accents, no purple gradients
- Tightened rapid swap filter: requires `status === 'success'`, `interval === 0`, `quantity > 1`
- Added cumulative volume and time saved metrics to API and dashboard
- Added `blocks_used` column (migration 004) computed from `height` and `streamingSwapMeta.lastHeight`
- Added memo-based target asset fallback for pending swaps missing output data
- Built WebSocket listener (`scripts/rapid-swap-listener.mjs`) that subscribes to NewBlock events, parses `streaming_swap` EndBlock events, fetches full action from Midgard, and upserts to Supabase
- Deployed listener as systemd service on Hetzner server with heartbeat reporting
- Added WS LIVE/DOWN indicator to dashboard status bar with block number and pulse animation
- Switched all THORNode/Midgard endpoints to `thorchain.network` as primary with Liquify/NineRealms fallback
- Updated favicon to THORChain icon SVG
- Added THORDEX swap link to footer
- Installed Node.js 22 on Hetzner server
- Backfilled historical rapid swaps (30 total, $230k volume)

## Discoveries

- Midgard reports `streamingSwapMeta.interval: "0"` for in-progress swaps that actually have `interval=1` on THORNode — must filter for `status=success` to avoid false positives
- True interval=0 swaps complete within a single block, so they never appear on THORNode's `/thorchain/swaps/streaming` endpoint — live tracking is impossible, only post-completion recording works
- `streaming_swap` events fire during `EndBlock`, not during transaction delivery — must subscribe to `NewBlock` events (not `Tx`) to catch them via WebSocket
- CometBFT WebSocket can't filter on custom event attributes server-side — must subscribe to all `NewBlock` events and filter client-side
- Midgard heights are returned as strings, need `Number()` not `safeNumber()` for block computation
- The `raw_action` JSONB stored in the DB contains all block height data needed for backfilling `blocks_used`

## Files Changed

| File | Change |
|------|--------|
| scripts/rapid-swap-listener.mjs | NEW: WebSocket listener for real-time rapid swap detection |
| scripts/rapid-swap-listener.service | NEW: systemd service unit |
| scripts/deploy-listener.sh | NEW: deployment script for Hetzner |
| supabase/migrations/004_rapid_swaps_blocks_used.sql | NEW: adds blocks_used column |
| docs/deployment.md | NEW: server deployment guide |
| src/lib/RapidSwaps.svelte | Full redesign: terminal aesthetic, removed live section, added cumulative/time-saved/blocks columns, WS status indicator |
| src/App.svelte | Single-app mode, base path routing, terminal header, JetBrains Mono font |
| src/lib/rapid-swaps/model.js | Tightened isRapidSwapAction filter, added computeBlocksUsed, memo-based target asset fallback |
| src/lib/rapid-swaps/api.js | Updated live filter for quantity > 1 |
| src/lib/api/thornode.js | Added thorchain.network as primary provider |
| src/lib/api/midgard.js | Switched to midgard.thorchain.network |
| src/lib/utils/api.js | Updated endpoint URLs |
| src/lib/node-operator/api.js | Updated endpoint URLs |
| src/lib/api/index.js | Updated endpoint exports |
| supabase/functions/rapid-swaps/index.ts | Added cumulative_volume_usd, time_saved_seconds, blocks_used, ws_listener status |
| supabase/functions/_shared/rapid-swaps.ts | Added thorchain.network to Midgard fallback chain |
| supabase/functions/_shared/thornode.ts | thorchain.network as primary |
| src/lib/Footer.svelte | Rebranded, added THORDEX link |
| src/lib/BuyRune.svelte | BOONE Tools branding |
| src/lib/DesktopApp.svelte | BOONE Tools branding |
| src/lib/LiquidityProviders.svelte | BOONE Tools branding |
| index.html | Updated favicon, title |
| src/app.html | Updated favicon |

## In Progress

None - session complete. All changes deployed and live.

## Next Steps

- [ ] Consider disabling the GitHub Actions 5-minute scheduler now that the WebSocket listener is running (or keep as backup)
- [ ] Monitor WebSocket listener stability over the next few days via `journalctl -u rapid-swap-listener -f`
- [ ] Add asset logos/icons next to pair names in the table
- [ ] Consider adding a chart showing rapid swap volume over time
- [ ] Investigate whether the time saved calculation should use actual block times instead of assuming 6s

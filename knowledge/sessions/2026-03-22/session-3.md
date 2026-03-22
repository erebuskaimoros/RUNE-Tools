# Session 3 - Direct RPC WebSocket for Browser Clients

> Date: 2026-03-22
> Focus: Move live block monitoring from Supabase Realtime to direct THORChain RPC WebSocket in the browser

## Summary

Replaced the Supabase Realtime subscription with a direct WebSocket connection from each browser client to `wss://rpc.thorchain.network/websocket`. Each client now subscribes to NewBlock events and parses `streaming_swap` EndBlock events client-side, triggering an API refresh only when a rapid swap is detected. This eliminates our backend as a traffic relay for live monitoring, drops the frontend bundle from 187kB to 13kB (removed `@supabase/supabase-js` from the browser), and leverages THORChain's generous rate limits.

## Work Done

- Removed `@supabase/supabase-js` import from `RapidSwaps.svelte` (was 187kB bundled)
- Added direct WebSocket connection to `wss://rpc.thorchain.network/websocket` in the browser
- Implemented client-side `streaming_swap` event parsing with base64 attribute decoding
- Added 8-second debounced refresh after detecting a rapid swap (gives server-side listener time to process and upsert)
- Auto-reconnect with exponential backoff on WebSocket disconnect
- Updated status bar: shows browser's direct RPC connection status and current block number
- Increased fallback poll interval to 2 minutes (WebSocket handles real-time)
- Removed Supabase Realtime migration (005) — still applied but no longer used by frontend

## Discoveries

- Browser WebSocket to Tendermint RPC works perfectly — CORS is open, no auth needed
- Moving monitoring to the client means zero bandwidth cost on our infra for live updates
- The `@supabase/supabase-js` SDK adds ~175kB to the bundle just for Realtime — overkill when native WebSocket does the job
- 8-second debounce after detection is needed to let the server-side listener fetch from Midgard, normalize, and upsert before the browser refreshes

## Files Changed

| File | Change |
|------|--------|
| src/lib/RapidSwaps.svelte | Replaced Supabase Realtime with direct RPC WebSocket, client-side event parsing, debounced refresh, updated status bar |

## In Progress

None - session complete.

**Post-deploy fix**: Footer crash — `const totalPages = pages.length` was declared before `pages` was defined, causing `ReferenceError: Cannot access 'O' before initialization` in Svelte 5. Fixed by using `let totalPages = 1` and assigning `totalPages = pages.length` after the `pages` array definition.

## Next Steps

- [ ] Monitor that browser WS connections don't get rate-limited at scale
- [ ] Add asset logos/icons next to pair names in the table
- [ ] Add a chart showing rapid swap volume over time
- [ ] Consider removing `@supabase/supabase-js` from package.json since it's no longer used in the frontend

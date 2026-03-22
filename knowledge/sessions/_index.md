# Sessions Index

## Recent Sessions

| Session | Focus | Summary | Path |
|---|---|---|---|
| 2026-03-22 #2 | WS Listener Fix + Realtime Dashboard | Fixed listener retry logic for Midgard delays, backfilled 30 swaps, added Supabase Realtime for live dashboard updates. | `sessions/2026-03-22/session-2.md` |
| 2026-03-22 #1 | Rapid Swaps full stack deploy + WebSocket listener | Deployed backend, redesigned UI (terminal aesthetic), tightened filters, built real-time WS listener on Hetzner, switched to thorchain.network endpoints. | `sessions/2026-03-22/session-1.md` |
| 2026-03-19 #1 | Rapid Swaps dashboard and recorder | Added a Rapid Swaps dashboard, shared rapid-swap parsing/tests, and a Supabase-backed recorder with scheduler wiring for top-20 and 24-hour tracking. | `sessions/2026-03-19/session-1.md` |
| 2026-02-27 #1 | Node Operator backend hardening and leaderboard UX | Fixed slash undercount logic, cut over to current-window leaderboard, added active-set filters/links/dropdown, and deployed backend updates. | `sessions/2026-02-27/session-1.md` |

## Current Work In Progress

- WebSocket listener running on Hetzner — monitor stability and retry logic over next 24h
- Wallet provider compatibility refactor is partially staged in working tree (NodeOperator.svelte, wallet.js)

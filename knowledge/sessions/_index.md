# Sessions Index

## Recent Sessions

| Session | Focus | Summary | Path |
|---|---|---|---|
| 2026-03-19 #1 | Rapid Swaps dashboard and recorder | Added a Rapid Swaps dashboard, shared rapid-swap parsing/tests, and a Supabase-backed recorder with scheduler wiring for top-20 and 24-hour tracking. | `sessions/2026-03-19/session-1.md` |
| 2026-02-27 #1 | Node Operator backend hardening and leaderboard UX | Fixed slash undercount logic, cut over to current-window leaderboard, added active-set filters/links/dropdown, and deployed backend updates. | `sessions/2026-02-27/session-1.md` |

## Current Work In Progress

- Rapid Swaps backend deployment and warm-up are pending:
  - apply `supabase/migrations/003_rapid_swaps_schema.sql`
  - deploy `rapid-swaps` and `rapid-swaps-scheduler`
  - configure scheduler/frontend env vars and allow 24h recorder warm-up
- Wallet provider compatibility refactor is partially staged in working tree and intentionally excluded from session commit:
  - `/Users/boonewheeler/Desktop/Projects/THORChain/boonetools/RUNE-Tools/src/lib/node-operator/wallet.js`
  - `/Users/boonewheeler/Desktop/Projects/THORChain/boonetools/RUNE-Tools/src/lib/NodeOperator.svelte`

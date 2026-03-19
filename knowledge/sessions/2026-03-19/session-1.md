# Session 1 - Rapid Swaps Dashboard And Recorder

> Date: 2026-03-19
> Focus: Add a Rapid Swaps dashboard plus backend recording flow for top-20 and rolling 24-hour tracking

## Summary

Built a new Rapid Swaps feature in `RUNE-Tools` that surfaces live active rapid streams from THORNode and recorded rapid swaps from a Supabase-backed tracker. The session also added shared rapid-swap parsing logic, tests for the new detection/ranking behavior, and deployment/scheduler wiring so the tracker can persist the largest and latest rapid swaps over time.

## Work Done

- Added a new `Rapid Swaps` app entry and built the dashboard UI for live active rapid swaps, top 20 largest recorded rapid swaps, and the recorded 24-hour feed.
- Implemented shared rapid-swap parsing and normalization helpers to detect `interval = 0` swaps from Midgard action data and estimate USD size from current pool prices.
- Added a backend schema, public edge function, and scheduler edge function to record recent rapid swaps into Supabase.
- Added a GitHub Actions scheduler to trigger rapid-swap ingestion every 5 minutes.
- Added backend documentation covering env vars, deployment, scheduler setup, and warm-up behavior.
- Added a small Node test suite for memo parsing, rapid-swap detection, normalization, and ranking behavior.
- Verified the feature with `npm test` and `npm run build`.

## Discoveries

- THORChain rapid swaps are identifiable through effective streaming interval `0`; Midgard may expose this either through `metadata.swap.streamingSwapMeta.interval` or only in the memo, so both paths need to be parsed.
- Public THORNode endpoints expose current active streaming swaps, but historical rapid-swap tracking still needs app-side recording because the public APIs do not provide a direct durable "all rapid swaps in the last 24h" feed.
- The existing `RUNE-Tools` repo already had unrelated wallet-provider refactor edits in `src/lib/NodeOperator.svelte` and `src/lib/node-operator/wallet.js`, so the rapid-swaps commit should exclude those files.
- The recorded 24-hour view is only complete after the scheduler has been deployed and allowed to run long enough to accumulate a full rolling day of data.

## Files Changed

| File | Change |
|------|--------|
| package.json | Added a `node --test` script for the new rapid-swap unit tests. |
| scripts/nodeop-backend-deploy.sh | Extended the deploy helper to push the rapid-swaps edge functions. |
| src/App.svelte | Registered the new `Rapid Swaps` dashboard entry. |
| src/lib/RapidSwaps.svelte | Added the full rapid-swaps dashboard UI. |
| src/lib/rapid-swaps/model.js | Added shared parsing, normalization, filtering, and ranking helpers. |
| src/lib/rapid-swaps/api.js | Added frontend loaders for recorded and live rapid-swap data. |
| tests/rapid-swaps.test.js | Added tests for memo parsing, rapid detection, normalization, and ranking. |
| supabase/migrations/003_rapid_swaps_schema.sql | Added tables and indexes for recorded rapid swaps and scheduler runs. |
| supabase/functions/_shared/rapid-swaps.ts | Added shared Midgard/THORNode ingestion helpers for rapid swaps. |
| supabase/functions/rapid-swaps/index.ts | Added a public edge function that returns top-20 and 24-hour rapid-swap views. |
| supabase/functions/rapid-swaps-scheduler/index.ts | Added a service-role scheduler edge function that ingests recent rapid swaps. |
| .github/workflows/rapid-swaps-scheduler.yml | Added a 5-minute scheduler trigger for the recorder backend. |
| docs/rapid-swaps-backend.md | Documented backend setup, deployment, env vars, and warm-up expectations. |

## In Progress

- Rapid-swaps backend deployment is still pending:
  - Apply `supabase/migrations/003_rapid_swaps_schema.sql`
  - Deploy `rapid-swaps` and `rapid-swaps-scheduler`
  - Set scheduler secrets and let the recorder warm up for 24 hours
- Existing wallet provider compatibility refactor remains intentionally excluded from this session commit:
  - `src/lib/NodeOperator.svelte`
  - `src/lib/node-operator/wallet.js`

## Next Steps

- [ ] Apply the new Supabase migration and deploy the `rapid-swaps` edge functions.
- [ ] Set `RAPID_SWAPS_SCHEDULER_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optional `NODEOP_SCHEDULER_SECRET` for the new GitHub Actions workflow.
- [ ] Configure `VITE_RAPID_SWAPS_API_BASE` and `VITE_RAPID_SWAPS_API_KEY` in the frontend host, or reuse the existing Node Operator backend env vars.
- [ ] Let the recorder run long enough to fill the rolling 24-hour dataset and verify production data quality.
- [ ] Decide whether the current wallet provider compatibility refactor should be finished in a follow-up session before the next deploy.

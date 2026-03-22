# Session 5 - Per-Swap and Aggregate Time Savings with Percentage Context

> Date: 2026-03-22
> Focus: Add percentage-based time savings metrics to both aggregate dashboard and per-swap table rows

## Summary

Added contextual time savings metrics — both aggregate and per-swap. The dashboard now shows total percentage faster, baseline time (what interval=1 would have taken), and actual time alongside time saved. Each swap row in the tables shows its individual time saved with percentage. This gives users meaningful context: "28% faster" is far more informative than "5m 18s saved."

## Work Done

- Added `baseline_seconds`, `actual_seconds`, and `pct_faster` fields to the Supabase `rapid-swaps` API response
- Added two new metric cards: TIME SAVED (with baseline subtitle) and FASTER (with actual vs baseline subtitle)
- Added per-swap SAVED column to both Top Recorded and Last 24 Hours tables showing e.g. "42s (35%)"
- Changed metrics grid from fixed 5-column to `auto-fit` for flexible layout with 7 cards
- Added `swapPctFaster()` and `swapTimeSaved()` helper functions in frontend
- Deployed API function and frontend

## Discoveries

- For 2-sub swaps, time saved is often 0 (2 subs in 2 blocks) — the advantage is primarily for higher sub-count swaps
- Current aggregate: 28% faster overall (834s actual vs 1152s baseline)

## Files Changed

| File | Change |
|------|--------|
| supabase/functions/rapid-swaps/index.ts | Added baseline_seconds, actual_seconds, pct_faster to API response |
| src/lib/RapidSwaps.svelte | Added FASTER metric card, per-swap SAVED column in both tables, auto-fit grid |

## In Progress

None - session complete.

## Next Steps

- [ ] Add asset logos/icons next to pair names
- [ ] Add volume-over-time chart
- [ ] Consider showing per-swap baseline time (e.g. "would have taken 2m") in a tooltip

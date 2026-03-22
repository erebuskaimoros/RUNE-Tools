# Session 4 - Time Saved Validation + Trade Account Asset Pricing Fix

> Date: 2026-03-22
> Focus: Validate time saved calculation against real on-chain data and fix trade account asset USD pricing

## Summary

Analyzed non-rapid streaming swaps on-chain to validate the time saved metric. Confirmed that interval=1 swaps use exactly 1 block per sub-swap, making `(subs - blocksUsed) * 6s` a fair comparison. Fixed a pricing bug where trade account assets (using `CHAIN-ASSET` dash format instead of `CHAIN.ASSET` dot format) returned $0 USD estimates. Updated the time saved label to clarify comparison basis.

## Work Done

- Queried Midgard for non-rapid streaming swaps to compare block usage patterns
- Confirmed interval=1 swaps: blocks == subs exactly (e.g., 61/61 in 61 blocks)
- Validated current formula `(subs - blocksUsed) * 6` is correct for interval=1 comparison
- Updated TIME SAVED label to "vs interval=1 streaming"
- Fixed `lookupAssetUsd` to handle trade account assets (`CHAIN-ASSET` → `CHAIN.ASSET` fallback)
- Patched tx 4F1A5605 from $0 to $499.24
- Redeployed scheduler, WS listener, and frontend with the fix

## Discoveries

- **Trade account assets use dash format**: Midgard returns `BSC-USDT-0X55D...` for trade accounts vs `BSC.USDT-0X55D...` for L1 pool assets. The price index only has the dot version. (Evergreen — should be noted in TC knowledge)
- **interval=1 is the fair baseline**: On-chain data shows interval=1 swaps use exactly 1 block per sub-swap with no overhead. Rapid swaps (interval=0) consolidate multiple subs per block, which is the actual time saving.
- **The first block is not "wasted"**: The inbound acceptance block also executes the first sub-swap, so `height` to `lastHeight` accurately captures execution time for both rapid and non-rapid swaps.

## Files Changed

| File | Change |
|------|--------|
| src/lib/rapid-swaps/model.js | Added trade account asset fallback in lookupAssetUsd (dash→dot conversion) |
| src/lib/RapidSwaps.svelte | Added "vs interval=1 streaming" label under TIME SAVED metric |

## In Progress

None - session complete.

## Next Steps

- [ ] Scan for other trade account rapid swaps that may have $0 USD and backfill
- [ ] Add asset logos/icons next to pair names
- [ ] Add volume-over-time chart

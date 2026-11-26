# ADR 0027: The public demo pays only rent it needs, and reports how many runs are left

- Status: accepted
- Date: 2026-11-26

## Context

The no-wallet demo on devnet is paid for by two server keys: the demo shop key (shared demo shop, and the SOL for each
dying shop of path C) and the fee relayer (holder transactions and the keeper's permissionless steps). Path C funded
each throwaway shop owner with a fixed 0.03 SOL; the owner spent about 0.005 SOL of it on rent and its key is discarded
after issue, so the rest could never be spent again. Nothing told the operator how many demo runs the keys had left.

## Decision

- **A dying shop owner gets the rent of the accounts it pays for**, read with `getMinimumBalanceForRentExemption` (shop,
  vault, warranty; once per size per process), plus `dyingShop.marginLamports` from `config/app.json` (0). A non-zero
  margin below the rent of an empty account is refused, because the runtime would reject the transaction.
- **The owner's token account is closed back to the demo shop key** in the same transaction as the deposit and issue.
- **`/api/health` reports `runsLeft {demoSeller, relayer}` and `balancesSol`**: balance divided by
  `web.health.runCostSol`, the cost of one run measured on devnet (`docs/MEASURED.md`). `deploy/uptime.sh` warns once a
  day when a key is under `web.health.minRuns`.
- The program is unchanged: rent locked in shop, vault and warranty accounts stays, since warranties are never closed.

## Undo

Revert the two commits that add `dyingShopLamports` and `fundsCheck`; set `dyingShop.sol` back in `config/app.json`.

# Uniswap V3 Direct Execution Note

This note explains why Phalanx does not use the default `onchainos defi invest/withdraw` path for the live Uniswap V3 LP demo on Base, and what we wired instead for the evaluation flow.

## Summary

- `phalanx_uniswap_liquidity_plan` is still the planning and discovery entry point.
- `onchainos wallet contract-call` is still the transaction signer / broadcaster through the OKX Agentic Wallet.
- Phalanx now assembles the Uniswap V3 `NonfungiblePositionManager` calldata itself for the live LP execution lane on Base.

## Why the default path was not enough

During live testing on Base, the default `onchainos defi invest/withdraw` route for Uniswap V3 LP consistently simulated through an internal wrapper path and reverted before broadcast.

The observed mismatch was:

- the high-level route produced an `executeWithPermit(...)`-style path
- the successful reference transactions used the canonical Uniswap V3 `NonfungiblePositionManager`
- the real successful pattern was `ERC20 approve -> NPM multicall(mint, refundETH)` for deposit
- the real successful pattern was `NPM multicall(decreaseLiquidity, collect)` for withdraw

Because of that mismatch, keeping the high-level LP route would have meant claiming a live path that we could not actually close on-chain.

## What Phalanx now does

For `target=uniswap-v3`:

1. Read pool detail from `onchainos defi detail`
2. Reuse the official planner handoff for execution intent / payload shape
3. Map operator-supplied token amounts onto the pool's underlying token order
4. Submit `wallet contract-call` steps through the Agentic Wallet:
   - ERC20 `approve` for non-native token legs
   - `NonfungiblePositionManager.multicall([mint, refundETH])` for deposit
   - `NonfungiblePositionManager.multicall([decreaseLiquidity, collect])` for withdraw
5. Poll tx status after each broadcast before sending the next step

This keeps the secure execution boundary inside OnchainOS while letting Phalanx control the exact Uniswap V3 calldata shape.

## Current scope

The current direct lane is intentionally scoped for the demo closure:

- live-tested target: Base `Uniswap V3`
- deposit currently expects explicit `tickLower` and `tickUpper`
- deposit expects minimal-unit amounts
- withdraw expects a real `tokenId` and uses on-chain position liquidity to resolve the burn amount from `ratio`
- no local LP metadata cache is introduced in this round
- `pancakeswap-v3` still stays on the original LP execution interface

## Operator inputs

For the direct live roundtrip, provide:

- `PHALANX_LP_INVESTMENT_ID`
- `PHALANX_LP_AMOUNT`
- `PHALANX_LP_AMOUNT_SECONDARY`
- `PHALANX_LP_TICK_LOWER`
- `PHALANX_LP_TICK_UPPER`

Optional:

- `PHALANX_LP_CHAIN` (currently `base`)
- `PHALANX_LP_TOKEN`
- `PHALANX_LP_TOKEN_SECONDARY`
- `PHALANX_LP_WITHDRAW_TOKEN_ID`
- `PHALANX_LP_WITHDRAW_RATIO`

`PHALANX_LP_RANGE` can still be kept as planning context, but the direct execution path should not rely on range-only inputs for live deposit.

## What judges should understand

The important product point is not that Phalanx bypasses OnchainOS. It does not.

The actual design is:

- planning and pool discovery: planner skill + OnchainOS detail/discovery
- secure signing and broadcast: OnchainOS Agentic Wallet
- exact Uniswap V3 execution encoding: Phalanx runtime

This is a deliberate integration fix so the demo shows a real end-to-end LP roundtrip instead of a synthetic or partially working abstraction.

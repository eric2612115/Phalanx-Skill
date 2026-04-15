# AgentPhalanx Review Narrative

`AgentPhalanx` is a Telegram-first, local-first DeFi operator runtime. The code lives in the `Phalanx-Skill` repository for compatibility, but the product story is now broader than a single "skill": the runtime coordinates Telegram onboarding, active OKX Agentic wallet selection, paid intelligence access, x402 payment replay, governance, approval routing, and onchain execution through `Onchain OS`.

The intended wallet model is a small fleet, not a single static wallet. One operator may keep multiple Gmail identities, and each Gmail profile may own multiple OKX Agentic wallets. The runtime stores that registry locally as `profiles[] -> wallets[]`, keeps an `activeProfileId` and `activeWalletId`, and treats the active wallet as the default identity for runtime evidence, operator summaries, and paid OmRate access.

`OmRate` should be described briefly in Phalanx-facing material: it is a cross-protocol DeFi rate aggregator built by this team and used here as the paid intelligence layer. The product-facing API base is `https://api.omrate.com`; deeper OmRate internals belong in the OmRate repo or site, not in the Phalanx README.

For paid OmRate calls, AgentPhalanx now prefers the active Agentic wallet and ranks `accepts[]` as `X Layer (eip155:196)` first, `Base (eip155:8453)` second. The runtime checks the active wallet against the required asset on the preferred network, falls back to Base only when X Layer is present but insufficient, and records the selected network, wallet identity, and payment evidence in runtime state. `PHALANX_X402_NETWORK` is now a debug override, not the silent default product path.

The default demo cut remains the stable `deposit` mainline. The fuller product story is the proactive allocation lane: Telegram onboarding, managed wallet confirmation, X Layer reserve funding, OmRate paid intelligence via x402, bounded operator queue management (`queue`, cancel, edit), and live execution with grouped transaction references sent back to Telegram. The runtime now also restores the active wallet, pending jobs, and guardian state from local memory-backed state before background work resumes.

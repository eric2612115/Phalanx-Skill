# Telegram-First Acceptance Matrix

This is the fixed acceptance contract for the Telegram-first AgentPhalanx operator flow.

Use it together with:

- `README.md`
- `docs/live-demo-runbook.md`
- `config.env.example`

## Contract Surfaces

Each scenario below should be checkable from the same bounded surfaces:

- `Telegram input`: the user message, button, or operator action that starts the scenario
- `Telegram reply`: what the operator sees in the bound private bot chat
- `Runtime / operator surfaces`: what should be visible from runtime events, `recent events`, `x402 summary`, `agent wallet`, or other bounded operator queries
- `Tx / explorer`: whether a tx hash must exist, and whether the Telegram report must group explorer links in a single message

Unless the scenario explicitly says otherwise:

- secrets must not be echoed in Telegram replies, runtime events, generic logs, or operator queries
- `OMRATE_API_KEY` remains optional
- `AGENT_WALLET_ADDRESS` is override-only and not the primary onboarding path
- `OKX_AGENTIC_WALLET_LOGIN_EMAIL` may be shown only when the current operator is explicitly confirming onboarding state

## 20 Scenarios

| ID | Scenario | Telegram input / trigger | Expected Telegram reply | Expected runtime / operator surfaces | Expected tx / explorer |
| --- | --- | --- | --- | --- | --- |
| S01 | Terminal bootstrap summary | `npm run init`, then `npm run dev` | none required from Telegram yet | terminal output points user to `@BotFather` -> `config.env` -> `npm run init` -> `npm run dev` -> Telegram `/start` | none |
| S02 | `/start` onboarding surface | `/start` in private chat | intro copy, `/claim` hint, FAQ keyboard, bounded operator shortcuts | no owner bind yet; lifecycle remains `UNCLAIMED` until claim | none |
| S03 | `/help` bounded operator help | `/help` or `help` in private chat | compact operator overview with keyboard | no state mutation; still bounded surface, not free-form assistant | none |
| S04 | FAQ answer from curated docs | FAQ button such as `Why OKX API trio?` | bounded answer grounded in docs, not arbitrary chat | no secret inspection, no runtime mutation, no action execution | none |
| S05 | Owner claim success | `/claim` then `confirm` in private chat | owner claim accepted, wizard begins at login email step | `TELEGRAM_ALLOWED_USER_ID` auto-written; lifecycle becomes `SETUP_IN_PROGRESS` | none |
| S06 | Owner claim rejected | `/claim` from wrong chat type or wrong user id | rejection / mismatch guidance | lifecycle stays `UNCLAIMED`; no owner bind mutation | none |
| S07 | Login email collection | valid `OKX_AGENTIC_WALLET_LOGIN_EMAIL` | step saved and next prompt | config persists login email; no generic event/log leakage of the raw email | none |
| S08 | Login email overwrite guard | `change login email` -> `confirm` -> new email | warning first, second confirmation required, then saved | config updates login email only after warning + confirm; runtime stays `READY` | none |
| S09 | OKX trio collection with masking discipline | OKX trio payload in Telegram wizard | next-step guidance without echoing raw values | secrets persisted locally; replies/errors/logs/events stay redacted | none |
| S10 | OmRate key skipped | `skip` at OmRate step | wizard continues to wallet bootstrap | `x402 summary` can still later show payment-required / attempted / wrapped / settled path | none |
| S11 | OTP incomplete / wallet unresolved | `continue` before managed wallet is available | explicit retry guidance: finish OTP / wallet bootstrap first | setup stays on `bootstrap_wallet`; no fake wallet success recorded | none |
| S12 | Managed wallet confirmed and recorded | `continue` after OTP / managed wallet success | current managed wallet address is shown, plus funding guidance | `OKX_AGENTIC_WALLET_CURRENT_ADDRESS` and `OKX_AGENTIC_WALLET_ADDRESS_HISTORY` persist; `agent wallet` query reflects managed path | none |
| S13 | Funding missing branch | user has not funded managed wallet and tries to continue live path | funding guidance remains explicit | runtime / demo flow must surface `funding_not_ready` or equivalent blocked reason; `recent events` / `what next` explain funding blocker | none |
| S14 | Funding confirmed and allocate prompt | `funded` | ask `allocate_now` or `skip` | wizard advances to allocate decision step | none |
| S15 | Allocate skipped but setup completes | `skip` at allocate decision | setup complete, runtime `READY` | lifecycle becomes `READY`; no allocation tx expected | none |
| S16 | Approval request, callback, and resume | guardian / deposit / allocation flow reaches approval, then Telegram approve callback | approval request arrives in same private chat; callback reply confirms resume | runtime events show proposal / awaiting approval / resumed / executed-or-blocked sequence with shared correlation id | tx may or may not exist yet, depending on post-resume execution result |
| S17 | Deposit mainline success | run deposit flow after READY and approve in Telegram | grouped completion report with final status, tx hashes, explorer links in one message | `recent events` shows execution summary and tx refs; wallet evidence stays aligned | at least one tx hash with grouped explorer link |
| S18 | Allocation mainline success with x402 evidence | run allocation flow after READY and approve in Telegram | grouped completion report includes x402/payment summary, execution evidence, tx refs | `recent events`, `runtime execution context`, and `x402 summary` agree on payment-required / attempted / wrapped / settled | one or more tx hashes with grouped explorer links |
| S19 | Execution-side failure surfaced cleanly | planner failure, wallet unresolved, funding not ready, or x402 payment failure during live flow | Telegram explains blocked / failed step without leaking secrets | runtime events capture blocked reason; `recent events` and `what next` show the same failure family; x402 failure remains visible in payment summary when applicable | no success tx link required; failed / absent tx is acceptable |
| S20 | Delivery / polling failure observability | Telegram `chat not found`, bot-token polling `409 Conflict`, or Telegram report delivery failure | operator may see missing report or fallback warning, but runtime must not silently lose the failure | runtime appends `report_failed` when delivery fails; operational notes point to single-poller discipline for `409 Conflict`; logs remain redacted | no explorer link required; failure evidence lives in runtime events |

## Scenario Notes

- `S09` covers secret-handling acceptance for OKX trio, optional OmRate key, and login email redaction discipline.
- `S12` is the happy path for managed-wallet-first onboarding; it intentionally does not bless `AGENT_WALLET_ADDRESS` as the default.
- `S17` is the stable deposit-oriented recording path.
- `S18` is the proactive allocation story and should be treated as the full demo flow when `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1`.
- `S19` and `S20` are failure acceptance scenarios, not product regressions by themselves; the goal is truthful, bounded observability.

## Live Execution Order

For a real operator run on a new machine, use this order:

1. terminal bootstrap: `npm run init` -> fill env -> `npm run dev`
2. private Telegram chat: `/start`
3. owner bind: `/claim` -> `confirm`
4. wizard progression: login email -> OKX trio -> optional OmRate -> managed wallet confirm -> funding confirm -> allocate now or skip
5. choose the proof path:
   - deposit-only: stable default recording path
   - allocation/x402: requires allocation demo env and is the fuller product story
6. wait for Telegram approval if the flow reaches a guarded action
7. confirm grouped completion report, tx links, and runtime/operator evidence match

## Operational Blocker Checklist

| Failure family | Immediate check | Expected bounded surface |
| --- | --- | --- |
| `chat not found` | verify the operator is messaging the same bot token and that `/claim` bound the intended private chat | Telegram reply in the target chat, matching `TELEGRAM_ALLOWED_USER_ID`, then approvals/reports land there |
| `409 Conflict` | ensure only one active Telegram poller / runtime is using the token | approvals and grouped reports resume without overlapping `getUpdates` errors |
| wallet unresolved | confirm OTP/login/bootstrap really completed and the current managed address was recorded | wizard stays on wallet step until success, then `agent wallet` shows the managed address |
| funding not ready | confirm the active managed wallet has assets before asking for execution | runtime blocks cleanly with funding guidance; after funding it moves on to approval/execution |
| allocation preflight blocked | confirm `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` and compatible `PHALANX_FLOW_PROFILE` are set | allocation flow starts instead of failing before the proactive story begins |

## Suggested Verification Mapping

- `S01-S04`: docs + local manual verification
- `S05-S15`: Telegram wizard tests and focused manual verification in a private bot chat
- `S16-S18`: smoke/manual live verification with real Telegram approvals
- `S19-S20`: failure injection, transport tests, runtime-event assertions, and operator-query review

## Minimal Evidence Checklist

For any scenario that claims success, capture at least:

- the Telegram input that triggered it
- the Telegram reply or grouped completion report
- the matching runtime event family in `recent events`
- the `x402 summary` snapshot when payment is part of the story
- grouped explorer links whenever a tx hash exists

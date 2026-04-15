# Phalanx-Skill Kernel Migration Matrix

This file is the active keep/split/move map while the current repository is converged into `Phalanx-Skill`.

## Disposition legend

- `keep_in_kernel`: stays in `Phalanx-Skill`
- `split_and_keep_kernel_part`: part remains in `Phalanx-Skill`, but product-shell ownership moves out
- `move_to_dephalanx`: target home is `DePhalanx`
- `deprecate_from_default_path`: may temporarily remain in-tree, but must not stay on the default kernel boot path

## Current module map

| Area | Disposition | Why |
| --- | --- | --- |
| `src/runtime/**` | `keep_in_kernel` | Canonical intent flow, pending operations, execution evidence, resume truth |
| `src/policy/**` | `keep_in_kernel` | Hard execution boundary and approval/whitelist semantics |
| `src/risk/**` | `keep_in_kernel` | Deterministic safety rules stay in the kernel |
| `src/executors/**` | `keep_in_kernel` | Bounded execution routing belongs in the action plane |
| `src/execution/**` | `keep_in_kernel` | Multi-step execution coordination remains kernel-owned |
| `src/mcp/**` | `keep_in_kernel` | Stable high-level action/query surface belongs in the kernel |
| `src/adapters/onchainos*.ts` | `keep_in_kernel` | Execution substrate integration is kernel-owned |
| `src/adapters/uniswap.ts` | `keep_in_kernel` | Supported protocol execution/planning adapter for kernel actions |
| `src/adapters/lp-execution*.ts` | `keep_in_kernel` | Protocol-safe LP execution remains kernel-owned |
| `src/adapters/owner-withdraw.ts` | `keep_in_kernel` | Execution-side owner withdrawal path belongs in the kernel |
| `src/adapters/whitelist-contract.ts` | `keep_in_kernel` | Chain-visible policy enforcement belongs in the kernel |
| `src/adapters/x402*.ts` | `keep_in_kernel` | Payment/evidence handling only where required for supported actions |
| `src/adapters/omrate.ts` | `split_and_keep_kernel_part` | Execution-side OmRate support stays; product-side opportunity discovery moves to `DePhalanx` |
| `src/adapters/portfolio.ts` | `split_and_keep_kernel_part` | Execution-facing normalized reads may stay; operator portfolio UX moves out |
| `src/app/host.ts` | `split_and_keep_kernel_part` | Kernel composition remains; mixed product-shell wiring must move out |
| `src/app/host-bootstrap.ts` | `split_and_keep_kernel_part` | Keep kernel bootstrap helpers only |
| `src/app/host-reporting.ts` | `deprecate_from_default_path` | Reporting should not remain on the default kernel boot path |
| `src/app/host-guardian-demo.ts` | `move_to_dephalanx` | Demo/product orchestration belongs in the product repo |
| `src/config/store.ts` | `split_and_keep_kernel_part` | Runtime config remains; product-shell config handling moves out |
| `src/config/agentic-wallet-registry.ts` | `split_and_keep_kernel_part` | Execution-critical identity data may stay, richer operator identity UX moves out |
| `src/memory/state-store.ts` | `split_and_keep_kernel_part` | Runtime pending state remains; conversation/profile memory moves out |
| `src/memory/mcp-memory-store.ts` | `split_and_keep_kernel_part` | Kernel state persistence remains only for execution truth |
| `src/memory/profile-memory.ts` | `move_to_dephalanx` | Long-term user preference memory belongs in the product layer |
| `src/memory/operational-memory.ts` | `move_to_dephalanx` | Product/operator memory belongs outside the kernel |
| `src/memory/conversation-memory.ts` | `move_to_dephalanx` | Conversational continuity is not kernel truth |
| `src/memory/compactor.ts` | `move_to_dephalanx` | Belongs with product-side memory ownership |
| `src/telegram/**` | `move_to_dephalanx` | Telegram ownership is a product-shell/channel concern |
| `src/guardian/**` | `move_to_dephalanx` | Mission-loop and scheduled product behavior move to `DePhalanx` |
| `src/operator/**` | `move_to_dephalanx` | Operator-facing portfolio/status/reporting belongs in the product repo |
| `src/demo/**` | `move_to_dephalanx` | Product story, allocation demos, and replay orchestration belong in `DePhalanx` |
| `src/strategy/**` | `move_to_dephalanx` | Evolves into `PhalanxLayer` and mandate logic |
| `scripts/start-runtime.ts` | `deprecate_from_default_path` | Mixed runtime entry should not remain the default kernel startup |
| `scripts/smoke-allocation-mainline.ts` | `move_to_dephalanx` | Product mainline rehearsal belongs in the product repo |
| `scripts/smoke-deposit-mainline.ts` | `deprecate_from_default_path` | Useful temporarily, but not a long-term kernel entry story |
| `scripts/telegram-approval-live-smoke.ts` | `move_to_dephalanx` | Channel approval rehearsal belongs with Telegram ownership |
| `scripts/live-smoke.ts` | `split_and_keep_kernel_part` | Keep kernel-only smoke steps; split out product-shell/channel assumptions |
| `scripts/init-operator.ts` | `deprecate_from_default_path` | Current mixed onboarding path is temporary |
| `config.env.example` | `split_and_keep_kernel_part` | Execution-side user config stays; product-shell config must be separated over time |
| `service.env.example` | `keep_in_kernel` | Runtime defaults remain kernel-owned, minus product-shell flags over time |

## Decision rule

If a module primarily:

- talks to operators
- owns channels
- stores long-term preferences
- runs mission loops
- shapes portfolio product behavior

then it belongs in `DePhalanx`, not `Phalanx-Skill`.

If a module primarily:

- enforces execution boundaries
- persists pending execution truth
- routes supported actions
- talks to execution substrates
- emits auditable execution evidence

then it belongs in `Phalanx-Skill`.

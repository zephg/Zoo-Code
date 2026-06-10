# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Local fork status

This repo is a long-running fork of [`Zoo-Code-Org/Zoo-Code`](https://github.com/Zoo-Code-Org/Zoo-Code) (git remote `upstream`). Day-to-day work happens on `local/daily-driver`; upstream tags are merged in on `local/merge-upstream-vX.Y.Z` branches and then fast-forwarded into `local/daily-driver`. The local-only architectural changes below are intentional and must be preserved across upstream merges.

After bumping the version in `src/package.json` (e.g. during an upstream merge), rebuild with `pnpm vsix --force` — turbo's cache does not track `src/package.json` as an input for the webview build, so the webview bundle will otherwise keep the old version inlined.

### Effort-based Anthropic reasoning (local-only architecture)

Anthropic Opus 4.6 / 4.7 / 4.8 use Anthropic's adaptive-thinking API with `output_config.effort`, not the legacy `budget_tokens` / binary toggle. The fork's static registry shape for these models is the contract that drives the request payload:

- `packages/types/src/providers/anthropic.ts` — Opus 4.6 / 4.7 / 4.8 declare `supportsReasoningEffort: [...]` (with `xhigh` only on 4.7 and 4.8 per Anthropic docs), `requiredReasoningEffort: true`, and `supportsTemperature: false`. They do NOT declare `supportsReasoningBudget`.
- `src/api/transform/reasoning.ts` — `getAnthropicReasoning` branches on `supportsReasoningEffort && !supportsReasoningBudget` and emits `{ thinking: { type: "adaptive" }, output_config: { effort } }`. Anything that re-declares `supportsReasoningBudget` on these models drops them onto the legacy budget path, which Opus 4.7+ rejects with a 400.
- `src/api/providers/anthropic.ts` and `src/api/providers/anthropic-vertex.ts` — destructure `reasoning?.thinking` and `reasoning?.output_config` from `getModel()` and spread both into the request. `getModelParams({ format: "anthropic" })` already wires reasoning; do NOT add a redundant `getAnthropicProviderReasoning` call.

Provider-specific notes:

- **Vertex** has no provider-side adaptive-thinking guard. The registry shape alone decides the payload. Opus 4.8 has been converted to the effort shape; **Opus 4.7 / 4.6 still declare `supportsReasoningBudget` and will 400 on the live API for 4.7 — known follow-up from `fd93c5bde`.** Do not "fix" the Bedrock-style mismatch by reintroducing the budget shape on Vertex 4.8.
- **Bedrock** has its own `isAdaptiveThinkingModel(modelId)` guard in `src/api/providers/bedrock.ts` that overrides the request payload regardless of the registry shape (matches `opus-4-7`, `opus-4-8`, `sonnet-4-7`, `sonnet-4-8` after `parseBaseModelId`). The bedrock registry entries declare the upstream-style `supportsReasoningBudget` shape — that is intentional and correct here.
- **OpenRouter** uses a dynamic model fetcher that reports `supportsReasoningEffort` as a boolean. The fetcher (`src/api/providers/fetchers/openrouter.ts`) patches known IDs (`anthropic/claude-opus-4.7`, `anthropic/claude-opus-4.8`, OpenAI gpt-5.5 family) to mirror the static effort arrays so `xhigh` / `max` remain reachable from the UI.

When adding a new effort-capable model, mirror the existing 4.7 / 4.8 entries and add a parametrized test in `src/api/providers/__tests__/anthropic.spec.ts` (effort assertion, `requiredReasoningEffort` always-on, user-chosen effort) rather than the upstream-style budget/binary assertions.

### Workspace-scoped code-index config (local-only)

`src/services/code-index/` has been extended with a two-scope config model: global (extension settings) plus a per-project `.roo/codebase-index.json` dotfile. Project scope overrides global; secrets are reconciled through `config-resolver.ts` and a file watcher reloads on dotfile changes. The published JSON Schema is at `packages/types/schemas/codebase-index.schema.json`; the UI surfaces the active scope and a "pinned-by-dotfile" badge. Keep the schema, the resolver tests, and the dotfile loader in sync when changing the shape.

### Known pre-existing test failures

`pnpm -w test` reports 22 failures on `local/daily-driver` from fixture drift introduced by `fd93c5bde`, all in `src/api/transform/__tests__/reasoning.spec.ts` and `src/api/transform/__tests__/model-params.spec.ts`. They predate every recent upstream merge. A clean validation pass on this fork = exactly those 22 failures and nothing else; a 23rd is the regression to investigate.

## Conventions

- Do NOT add `Co-Authored-By` trailers (or other agent/tool attribution) to commit messages or PR descriptions in this repo.

## Other guidance

- Settings View Pattern: When working on `SettingsView`, inputs must bind to the local `cachedState`, NOT the live `useExtensionState()`. The `cachedState` acts as a buffer for user edits, isolating them from the `ContextProxy` source-of-truth until the user explicitly clicks "Save". Wiring inputs directly to the live state causes race conditions.

## Test Placement Guidance

Prefer the narrowest test layer that proves the behavior. This follows standard test-pyramid guidance: keep most coverage in fast, focused tests; add integration tests for cross-module contracts; reserve end-to-end tests for full workflow confidence.

- Use package-local unit tests for pure logic, parsing, state transitions, validation, serialization, request construction, retry decisions, and error handling.
- Use integration tests when behavior depends on multiple internal modules working together, but does not require the real VS Code extension host or browser/webview runtime.
- Use `webview-ui` tests for React rendering, hooks, component state, forms, validation, and webview UI wiring.
- Use `apps/vscode-e2e` only when the behavior depends on the real VS Code extension host, VS Code workspace APIs, extension activation, webview/extension messaging, file watcher behavior, or a complete user workflow.
- Keep e2e tests focused on high-value smoke coverage across boundaries. Avoid placing detailed protocol, parsing, storage, retry, or edge-case assertions in e2e when they can be covered reliably at a lower layer.
- When fixing a regression, add the regression test at the lowest layer that would have failed for the bug. Add an e2e test only if lower-level tests cannot represent the failure mode.

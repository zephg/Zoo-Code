# FORK.md — local divergence & upstream-merge friction map

This repo is a long-running fork of [`Zoo-Code-Org/Zoo-Code`](https://github.com/Zoo-Code-Org/Zoo-Code)
(git remote `upstream`). Day-to-day work happens on `local/daily-driver`; upstream tags are
merged in on `local/merge-upstream-vX.Y.Z` branches and then fast-forwarded into
`local/daily-driver`.

This document is the single reference for **what we changed and where it will rub against
upstream on the next sync**. The local-only changes below are intentional and must be preserved
across merges. `AGENTS.md` only points here.

## How to use this during an upstream sync

1. Merge the upstream tag onto a `local/merge-upstream-vX.Y.Z` branch.
2. Resolve conflicts feature-by-feature using the tables below — the **conflict-prone** files are
   where merge markers land; the **fork-only** files won't conflict textually but may need
   re-wiring if upstream restructured the surrounding code.
3. Run the [post-merge checklist](#post-merge-checklist).
4. Fast-forward `local/daily-driver`.

> **Limitation:** the file lists here come from our fork's *non-merge* commits
> (`git log --no-merges upstream/main..local/daily-driver`). Conflicts that were already resolved
> *inside* past merge commits are not captured. When a new area starts conflicting, add a row.

## Divergence at a glance

| # | Local feature | Origin commit(s) | Nature |
|---|---|---|---|
| 1 | Effort-based Anthropic reasoning (Opus 4.6/4.7/4.8) | `fd93c5bde`, `64fc5fc98` | modifies shared provider logic |
| 2 | OpenRouter effort-array mirroring + gpt-5.5 defs | `062657a7d`, `64fc5fc98` | modifies shared fetcher/registry |
| 3 | Claude Fable 5 + safety-refusal handling | `811b5ca55` | modifies shared provider logic |
| 4 | `"max"` reasoningEffort i18n label | `dd675fd3b` | mechanical i18n |
| 5 | Workspace-scoped code-index config (`.roo/codebase-index.json`) | `3efa0728e`→`8f54e2274` (phases 1–5) | mostly new files + isolated wiring |

## Conflict-prone code paths (shared files we modified)

Risk = **upstream churn** (commits touching the file on `upstream/main` in the last 6 months) ×
**change nature** (isolated additive wiring merges cleanly; changes to shared *logic* conflict
hard). High churn with an isolated add is usually a clean 3-way merge; low churn on keystone logic
can still be the ugliest conflict.

### Feature 1+3 — Anthropic reasoning + Fable

| File | Upstream churn (6mo) | Our change | Change nature | Risk |
|---|---:|---|---|---|
| `packages/types/src/providers/anthropic.ts` | 10 | Effort-shape model entries (Opus 4.6/4.7/4.8, Fable 5): `supportsReasoningEffort`, `requiredReasoningEffort`, `supportsTemperature:false`, **no** `supportsReasoningBudget` | modifies contract registry | **HIGH** (this shape drives the request payload) |
| `src/api/transform/reasoning.ts` | 5 | `getAnthropicReasoning` branch on `supportsReasoningEffort && !supportsReasoningBudget` → `{ thinking:{type:"adaptive"}, output_config:{effort} }` | keystone logic | **HIGH** (low churn but ugliest if upstream refactors reasoning extraction) |
| `src/api/providers/anthropic.ts` | 23 | Spread `reasoning.thinking` + `reasoning.output_config` into request; Fable `stop_reason:"refusal"` → category-aware text chunk | modifies shared logic | **HIGH** |
| `src/api/providers/anthropic-vertex.ts` | 17 | Destructure + spread `reasoning.thinking`/`output_config`; no provider-side adaptive guard (registry shape alone decides payload) | modifies shared logic | **MED** |
| `packages/types/src/provider-settings.ts` | 17 | Effort field/enum plumbing | modifies shared types | **MED** |
| `src/shared/api.ts` | 12 | Effort plumbing | modifies shared types | **MED** |
| `packages/types/src/model.ts` | 4 | Effort type support | modifies shared types | **LOW–MED** |

**Provider guards to preserve (semantic, easy to break on merge):**
- **Vertex** has *no* provider-side adaptive-thinking guard — the registry shape alone decides the
  payload. Opus 4.8 is on the effort shape; **Opus 4.7/4.6 still declare `supportsReasoningBudget`
  and will 400 on the live API for 4.7 — known follow-up from `fd93c5bde`.** Do not "fix" this by
  reintroducing the budget shape on Vertex 4.8.
- **Bedrock** has its own `isAdaptiveThinkingModel(modelId)` guard in
  `src/api/providers/bedrock.ts` (matches `opus-4-7`, `opus-4-8`, `sonnet-4-7`, `sonnet-4-8` after
  `parseBaseModelId`) that overrides the payload regardless of registry shape. Bedrock registry
  entries keep the upstream-style `supportsReasoningBudget` shape — intentional and correct there.
- Anything that re-declares `supportsReasoningBudget` on the effort models drops them onto the
  legacy budget path, which Opus 4.7+ rejects with a 400.

When adding a new effort-capable model, mirror the existing 4.7/4.8 entries and add a parametrized
test in `src/api/providers/__tests__/anthropic.spec.ts` (effort assertion, `requiredReasoningEffort`
always-on, user-chosen effort) rather than upstream-style budget/binary assertions.

### Feature 2 — OpenRouter / OpenAI effort

| File | Upstream churn (6mo) | Our change | Change nature | Risk |
|---|---:|---|---|---|
| `packages/types/src/providers/openai.ts` | 8 | gpt-5.5 defs + static effort arrays | modifies registry | **MED** |
| `src/api/providers/fetchers/openrouter.ts` | 6 | Dynamic fetcher patches known IDs (`anthropic/claude-opus-4.7`, `anthropic/claude-opus-4.8`, gpt-5.5 family) to mirror the static effort arrays so `xhigh`/`max` stay reachable from the UI | modifies shared fetcher | **MED** |

### Feature 5 — Workspace-scoped code-index (modified shared files)

| File | Upstream churn (6mo) | Our change | Change nature | Risk |
|---|---:|---|---|---|
| `src/core/webview/ClineProvider.ts` | 81 | Wire code-index scope | isolated additive | **MED** (high churn, but additive — usually clean 3-way) |
| `src/core/webview/webviewMessageHandler.ts` | 59 | Code-index scope message handlers | isolated additive | **MED** |
| `packages/types/src/vscode-extension-host.ts` | 52 | Code-index host type | isolated additive | **MED** |
| `webview-ui/src/components/chat/CodeIndexPopover.tsx` | 2 | Scope switcher + pinned-by-dotfile badge | UI additive | **LOW–MED** |
| `src/services/code-index/manager.ts` | 2 | Two-scope wiring | our changes dominate | **LOW–MED** |
| `src/services/code-index/config-manager.ts` | 1 | Two-scope config model | our changes dominate | **LOW** |
| `packages/types/src/codebase-index.ts` | 1 | Config shape/types | our changes dominate | **LOW** |

### i18n

| Files | Our change | Risk |
|---|---|---|
| `webview-ui/src/i18n/locales/*/settings.json` (18 locales) | `"max"` reasoningEffort label + code-index scope strings | **MED** — frequent but mechanical; resolve by taking both sides / regenerating |

## Fork-only files (added — no textual conflict, watch for semantic drift)

These don't exist upstream, so they never produce merge markers. The risk is *drift*: if upstream
restructures the code-index service or the types package, these need re-wiring, not merging.

- `packages/types/schemas/codebase-index.schema.json` — published JSON Schema for the dotfile
- `packages/types/src/__tests__/codebase-index.test.ts`
- `src/services/code-index/config-resolver.ts` (+ `__tests__/config-resolver.spec.ts`) — reconciles
  global (extension settings) vs project (`.roo/codebase-index.json`) scope; secrets resolved here
- `src/services/code-index/dotfile-loader.ts` (+ `__tests__/dotfile-loader.spec.ts`) — loads the
  dotfile and watches it for reloads

Keep the schema, the resolver tests, and the dotfile loader in sync when the config shape changes.

## Recurring / expected conflicts (release mechanics)

These conflict on essentially **every** upstream merge and are expected — resolve mechanically,
don't investigate them as regressions.

- `src/package.json` — version string → re-bump (see checklist re: VSIX)
- `CHANGELOG.md` — take the union; keep our fork entries
- `README.md`, `locales/*/README.md`, `webview-ui/src/i18n/locales/*/chat.json` — release/marketing churn
- `AGENTS.md` — now just a pointer paragraph, so the footprint is small

## Post-merge checklist

- [ ] **Rebuild VSIX after any `src/package.json` version bump:** `pnpm vsix --force`. Turbo's cache
      does not track `src/package.json` as an input for the webview build, so the webview bundle
      otherwise keeps the old version inlined.
- [ ] **Test baseline:** `pnpm -w test` reports **exactly 22 failures** on `local/daily-driver`,
      all in `src/api/transform/__tests__/reasoning.spec.ts` and
      `src/api/transform/__tests__/model-params.spec.ts` (fixture drift from `fd93c5bde`, predates
      every recent merge). A clean run = those 22 and nothing else; a 23rd is the regression to
      investigate.
- [ ] Verify the Anthropic effort payload still emits `output_config.effort` (not `budget_tokens`)
      for Opus 4.7/4.8 — see the provider guards above.

## Regenerate this map

```bash
# Files our fork's non-merge commits touch (the divergence set):
git log --no-merges --name-status \
  --pretty=format:'>>> %h | %an | %s' upstream/main..local/daily-driver

# Upstream churn (6mo) for a given file — feeds the risk column:
git log --oneline --since='6 months ago' upstream/main -- <path> | wc -l
```

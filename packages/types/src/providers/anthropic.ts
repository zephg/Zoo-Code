import type { ModelInfo } from "../model.js"

// https://docs.anthropic.com/en/docs/about-claude/models
// https://platform.claude.com/docs/en/about-claude/pricing

export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-sonnet-4-5"

export const anthropicModels = {
	"claude-fable-5": {
		maxTokens: 128_000, // Requires streaming for large outputs.
		// Native 1M-token context window (the maximum is also the default); flat pricing.
		// Source: https://platform.claude.com/docs/en/about-claude/models/overview
		contextWindow: 1_000_000,
		supportsImages: true, // High-resolution vision.
		supportsPromptCache: true,
		// Fable-tier pricing is 2x Opus-tier on both input and output.
		inputPrice: 10.0, // $10 per million input tokens
		outputPrice: 50.0, // $50 per million output tokens
		cacheWritesPrice: 12.5, // $12.50 per million tokens (1.25x input)
		cacheReadsPrice: 1.0, // $1.00 per million tokens (0.1x input)
		// Thinking is always on — adaptive only. Unlike Opus 4.8, an explicit
		// `thinking: {type: "disabled"}` returns a 400, so we never send one; the
		// effort path emits `thinking: {type: "adaptive"}`. Effort controls depth.
		// Note: Fable uses a new tokenizer (~30% more tokens than Opus-tier for the
		// same content), so context-budget math calibrated on Opus will undercount.
		supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "high",
		supportsTemperature: false,
		supportsReasoningDisplay: true,
		description:
			"Claude Fable 5 is Anthropic's most capable widely released model, for the most demanding reasoning and long-horizon agentic work.",
	},
	"claude-sonnet-4-6": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag 'context-1m-2025-08-07'
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens (≤200K context)
		outputPrice: 15.0, // $15 per million output tokens (≤200K context)
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		// Tiered pricing for extended context (requires beta flag 'context-1m-2025-08-07')
		tiers: [
			{
				contextWindow: 1_000_000, // 1M tokens with beta flag
				inputPrice: 6.0, // $6 per million input tokens (>200K context)
				outputPrice: 22.5, // $22.50 per million output tokens (>200K context)
				cacheWritesPrice: 7.5, // $7.50 per million tokens (>200K context)
				cacheReadsPrice: 0.6, // $0.60 per million tokens (>200K context)
			},
		],
	},
	"claude-sonnet-5": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000, // 1M context window native (no beta header required)
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.0, // $2 per million input tokens (introductory pricing through Aug 31, 2026)
		outputPrice: 10.0, // $10 per million output tokens (introductory pricing through Aug 31, 2026)
		cacheWritesPrice: 2.5, // $2.50 per million tokens (introductory pricing through Aug 31, 2026)
		cacheReadsPrice: 0.2, // $0.20 per million tokens (introductory pricing through Aug 31, 2026)
		// Sonnet 5 is adaptive-thinking only, like Opus 4.7+ and Fable 5 on the
		// direct Anthropic provider path: manual extended thinking (budget_tokens)
		// is removed and returns a 400, and sampling parameters
		// (temperature/top_p/top_k) return a 400. Fork convention: drive it through
		// the effort path (thinking:{type:"adaptive"} + output_config.effort);
		// declaring supportsReasoningBudget would route it to the legacy budget
		// branch in getAnthropicReasoning and 400. Mirrors Opus 4.7/4.8/Fable 5.
		supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "high",
		supportsTemperature: false,
		supportsReasoningDisplay: true,
		description:
			"Claude Sonnet 5 is the best combination of speed and intelligence, optimized for coding, tool use, and agentic workflows.",
	},
	"claude-sonnet-4-5": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag 'context-1m-2025-08-07'
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens (≤200K context)
		outputPrice: 15.0, // $15 per million output tokens (≤200K context)
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		// Tiered pricing for extended context (requires beta flag 'context-1m-2025-08-07')
		tiers: [
			{
				contextWindow: 1_000_000, // 1M tokens with beta flag
				inputPrice: 6.0, // $6 per million input tokens (>200K context)
				outputPrice: 22.5, // $22.50 per million output tokens (>200K context)
				cacheWritesPrice: 7.5, // $7.50 per million tokens (>200K context)
				cacheReadsPrice: 0.6, // $0.60 per million tokens (>200K context)
			},
		],
	},
	"claude-sonnet-4-20250514": {
		maxTokens: 64_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000, // Default 200K, extendable to 1M with beta flag 'context-1m-2025-08-07'
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens (≤200K context)
		outputPrice: 15.0, // $15 per million output tokens (≤200K context)
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		// Tiered pricing for extended context (requires beta flag 'context-1m-2025-08-07')
		tiers: [
			{
				contextWindow: 1_000_000, // 1M tokens with beta flag
				inputPrice: 6.0, // $6 per million input tokens (>200K context)
				outputPrice: 22.5, // $22.50 per million output tokens (>200K context)
				cacheWritesPrice: 7.5, // $7.50 per million tokens (>200K context)
				cacheReadsPrice: 0.6, // $0.60 per million tokens (>200K context)
			},
		],
	},
	"claude-opus-4-6": {
		maxTokens: 128_000,
		// Native 1M-token context window; flat pricing.
		// Source: https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
		// Anthropic deprecated budget_tokens on Opus 4.6/4.7; adaptive thinking + effort replaces it.
		// Adaptive thinking constrains temperature server-side, so we omit temperature.
		// Per https://platform.claude.com/docs/en/build-with-claude/effort, xhigh is Opus 4.7-only.
		supportsReasoningEffort: ["low", "medium", "high", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "high",
		supportsTemperature: false,
		supportsReasoningDisplay: true,
	},
	"claude-opus-4-7": {
		maxTokens: 128_000,
		// Native 1M-token context window; flat pricing.
		// Source: https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
		// Opus 4.7 rejects budget_tokens entirely; adaptive thinking + effort is the only path.
		// Per https://platform.claude.com/docs/en/build-with-claude/effort:
		//   - xhigh is the recommended starting point for coding/agentic work on 4.7
		//   - API default is `high`; we default to `xhigh` to match Anthropic's recommendation
		supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "xhigh",
		supportsTemperature: false,
		supportsReasoningDisplay: true,
	},
	"claude-opus-4-8": {
		maxTokens: 128_000,
		// Native 1M-token context window; flat pricing (200k on Microsoft Foundry only).
		// Source: https://platform.claude.com/docs/en/about-claude/models/overview
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0,
		outputPrice: 25.0,
		cacheWritesPrice: 6.25,
		cacheReadsPrice: 0.5,
		// Opus 4.8 uses adaptive thinking only; manual `thinking: {type: "enabled", budget_tokens}`
		// returns a 400 error. Effort controls thinking depth.
		// Per https://platform.claude.com/docs/en/build-with-claude/effort:
		//   - Effort defaults to `high` on the API and Claude Code; Anthropic explicitly states
		//     this is "the best overall balance of quality and user experience" and yields
		//     similar token usage to Opus 4.7's xhigh default but with better performance.
		//   - `xhigh` is recommended for difficult tasks and long-running async workflows.
		supportsReasoningEffort: ["low", "medium", "high", "xhigh", "max"],
		requiredReasoningEffort: true,
		reasoningEffort: "high",
		supportsTemperature: false,
		supportsReasoningDisplay: true,
	},
	"claude-opus-4-5-20251101": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
		outputPrice: 25.0, // $25 per million output tokens
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		supportsReasoningBudget: true,
	},
	"claude-opus-4-1-20250805": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0, // $15 per million input tokens
		outputPrice: 75.0, // $75 per million output tokens
		cacheWritesPrice: 18.75, // $18.75 per million tokens
		cacheReadsPrice: 1.5, // $1.50 per million tokens
		supportsReasoningBudget: true,
	},
	"claude-opus-4-20250514": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0, // $15 per million input tokens
		outputPrice: 75.0, // $75 per million output tokens
		cacheWritesPrice: 18.75, // $18.75 per million tokens
		cacheReadsPrice: 1.5, // $1.50 per million tokens
		supportsReasoningBudget: true,
	},
	"claude-3-7-sonnet-20250219:thinking": {
		maxTokens: 128_000, // Unlocked by passing `beta` flag to the model. Otherwise, it's 64k.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"claude-3-7-sonnet-20250219": {
		maxTokens: 8192, // Since we already have a `:thinking` virtual model we aren't setting `supportsReasoningBudget: true` here.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
	},
	"claude-3-5-sonnet-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
	},
	"claude-3-5-haiku-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
	"claude-3-opus-20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-haiku-20240307": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.03,
	},
	"claude-haiku-4-5-20251001": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
		supportsReasoningBudget: true,
		description:
			"Claude Haiku 4.5 delivers near-frontier intelligence at lightning speeds with extended thinking, vision, and multilingual support.",
	},
} as const satisfies Record<string, ModelInfo>

export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192

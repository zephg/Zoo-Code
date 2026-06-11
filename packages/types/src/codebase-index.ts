import { z } from "zod"

/**
 * Codebase Index Constants
 */
export const CODEBASE_INDEX_DEFAULTS = {
	MIN_SEARCH_RESULTS: 10,
	MAX_SEARCH_RESULTS: 200,
	DEFAULT_SEARCH_RESULTS: 50,
	SEARCH_RESULTS_STEP: 10,
	MIN_SEARCH_SCORE: 0,
	MAX_SEARCH_SCORE: 1,
	DEFAULT_SEARCH_MIN_SCORE: 0.4,
	SEARCH_SCORE_STEP: 0.05,
} as const

/**
 * CodebaseIndexConfig
 */

export const codebaseIndexConfigSchema = z.object({
	codebaseIndexEnabled: z.boolean().optional(),
	codebaseIndexQdrantUrl: z.string().optional(),
	codebaseIndexEmbedderProvider: z
		.enum([
			"openai",
			"ollama",
			"openai-compatible",
			"gemini",
			"mistral",
			"vercel-ai-gateway",
			"bedrock",
			"openrouter",
			"semble",
		])
		.optional(),
	codebaseIndexEmbedderBaseUrl: z.string().optional(),
	codebaseIndexEmbedderModelId: z.string().optional(),
	codebaseIndexEmbedderModelDimension: z.number().optional(),
	codebaseIndexSearchMinScore: z.number().min(0).max(1).optional(),
	codebaseIndexSearchMaxResults: z
		.number()
		.min(CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS)
		.max(CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS)
		.optional(),
	// OpenAI Compatible specific fields
	codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
	codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
	// Bedrock specific fields
	codebaseIndexBedrockRegion: z.string().optional(),
	codebaseIndexBedrockProfile: z.string().optional(),
	// OpenRouter specific fields
	codebaseIndexOpenRouterSpecificProvider: z.string().optional(),
})

export type CodebaseIndexConfig = z.infer<typeof codebaseIndexConfigSchema>

/**
 * CodebaseIndexModels
 */

export const codebaseIndexModelsSchema = z.object({
	openai: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	ollama: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	"openai-compatible": z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	gemini: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	mistral: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	"vercel-ai-gateway": z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	openrouter: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	bedrock: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	semble: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
})

export type CodebaseIndexModels = z.infer<typeof codebaseIndexModelsSchema>

/**
 * CdebaseIndexProvider
 */

export const codebaseIndexProviderSchema = z.object({
	codeIndexOpenAiKey: z.string().optional(),
	codeIndexQdrantApiKey: z.string().optional(),
	codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
	codebaseIndexOpenAiCompatibleApiKey: z.string().optional(),
	codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
	codebaseIndexGeminiApiKey: z.string().optional(),
	codebaseIndexMistralApiKey: z.string().optional(),
	codebaseIndexVercelAiGatewayApiKey: z.string().optional(),
	codebaseIndexOpenRouterApiKey: z.string().optional(),
})

export type CodebaseIndexProvider = z.infer<typeof codebaseIndexProviderSchema>

/**
 * CodebaseIndexWorkspaceConfig
 *
 * Shape stored in VS Code workspaceState when the user picks scope=workspace in the UI.
 * Identical shape to CodebaseIndexConfig (all fields already optional), but exported
 * separately so the intent is explicit at call sites and so we can diverge if workspace
 * needs ever differ from global.
 */
export const codebaseIndexWorkspaceConfigSchema = codebaseIndexConfigSchema
export type CodebaseIndexWorkspaceConfig = z.infer<typeof codebaseIndexWorkspaceConfigSchema>

/**
 * Secret field names that must never appear in the `.roo/codebase-index.json` dotfile.
 * The dotfile is safe-to-commit; secrets belong in VS Code SecretStorage only.
 */
export const CODEBASE_INDEX_SECRET_FIELDS = [
	"codeIndexOpenAiKey",
	"codeIndexQdrantApiKey",
	"codebaseIndexOpenAiCompatibleApiKey",
	"codebaseIndexGeminiApiKey",
	"codebaseIndexMistralApiKey",
	"codebaseIndexVercelAiGatewayApiKey",
	"codebaseIndexOpenRouterApiKey",
] as const

/**
 * CodebaseIndexDotfile
 *
 * Schema for `.roo/codebase-index.json` (project-local or ~/.roo/ global).
 * Strict — extra fields (including secret fields) are rejected so the loader can
 * surface a meaningful warning.
 *
 * `$schema` is allowed so editors can offer autocomplete.
 */
export const codebaseIndexDotfileSchema = z
	.object({
		$schema: z.string().optional(),
		codebaseIndexEnabled: z.boolean().optional(),
		codebaseIndexQdrantUrl: z.string().optional(),
		codebaseIndexEmbedderProvider: codebaseIndexConfigSchema.shape.codebaseIndexEmbedderProvider,
		codebaseIndexEmbedderBaseUrl: z.string().optional(),
		codebaseIndexEmbedderModelId: z.string().optional(),
		codebaseIndexEmbedderModelDimension: z.number().optional(),
		codebaseIndexSearchMinScore: z.number().min(0).max(1).optional(),
		codebaseIndexSearchMaxResults: z
			.number()
			.min(CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS)
			.max(CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS)
			.optional(),
		codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
		codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
		codebaseIndexBedrockRegion: z.string().optional(),
		codebaseIndexBedrockProfile: z.string().optional(),
		codebaseIndexOpenRouterSpecificProvider: z.string().optional(),
	})
	.strict()

export type CodebaseIndexDotfile = z.infer<typeof codebaseIndexDotfileSchema>

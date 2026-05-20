import {
	CODEBASE_INDEX_SECRET_FIELDS,
	type CodebaseIndexConfig,
	type CodebaseIndexDotfile,
	type CodebaseIndexProvider,
} from "@roo-code/types"

import type { EmbedderProvider } from "./interfaces/manager"

export type ConfigSource = "project-dotfile" | "global-dotfile" | "workspace" | "global" | "default"

/**
 * Fully resolved code-index configuration. Flat shape — non-secrets and secrets merged together
 * so callers (config-manager) can slot it directly into instance variables.
 */
export interface ResolvedCodeIndexConfig {
	codebaseIndexEnabled: boolean
	codebaseIndexQdrantUrl?: string
	codebaseIndexEmbedderProvider: EmbedderProvider
	codebaseIndexEmbedderBaseUrl?: string
	codebaseIndexEmbedderModelId?: string
	codebaseIndexEmbedderModelDimension?: number
	codebaseIndexSearchMinScore?: number
	codebaseIndexSearchMaxResults?: number
	codebaseIndexOpenAiCompatibleBaseUrl?: string
	codebaseIndexOpenAiCompatibleModelDimension?: number
	codebaseIndexBedrockRegion?: string
	codebaseIndexBedrockProfile?: string
	codebaseIndexOpenRouterSpecificProvider?: string
	codeIndexOpenAiKey?: string
	codeIndexQdrantApiKey?: string
	codebaseIndexOpenAiCompatibleApiKey?: string
	codebaseIndexGeminiApiKey?: string
	codebaseIndexMistralApiKey?: string
	codebaseIndexVercelAiGatewayApiKey?: string
	codebaseIndexOpenRouterApiKey?: string
}

export type ResolvedConfigSources = Partial<Record<keyof ResolvedCodeIndexConfig, ConfigSource>>

export interface ResolverInputs {
	projectDotfile?: CodebaseIndexDotfile | null
	globalDotfile?: CodebaseIndexDotfile | null
	workspaceConfig?: Partial<CodebaseIndexConfig> | null
	globalConfig?: Partial<CodebaseIndexConfig> | null
	workspaceSecrets?: Partial<CodebaseIndexProvider> | null
	globalSecrets?: Partial<CodebaseIndexProvider> | null
}

export interface ResolverOutput {
	config: ResolvedCodeIndexConfig
	sources: ResolvedConfigSources
}

const NON_SECRET_FIELDS = [
	"codebaseIndexEnabled",
	"codebaseIndexQdrantUrl",
	"codebaseIndexEmbedderProvider",
	"codebaseIndexEmbedderBaseUrl",
	"codebaseIndexEmbedderModelId",
	"codebaseIndexEmbedderModelDimension",
	"codebaseIndexSearchMinScore",
	"codebaseIndexSearchMaxResults",
	"codebaseIndexOpenAiCompatibleBaseUrl",
	"codebaseIndexOpenAiCompatibleModelDimension",
	"codebaseIndexBedrockRegion",
	"codebaseIndexBedrockProfile",
	"codebaseIndexOpenRouterSpecificProvider",
] as const

type NonSecretField = (typeof NON_SECRET_FIELDS)[number]

interface Layer<T> {
	source: ConfigSource
	value: T | undefined
}

function pickFirst<T>(layers: Array<Layer<T>>): Layer<T> {
	for (const layer of layers) {
		if (layer.value !== undefined) return layer
	}
	return { source: "default", value: undefined }
}

/**
 * Merges code-index configuration across the precedence chain:
 *   projectDotfile → globalDotfile → workspaceConfig → globalConfig → defaults
 *
 * Secret fields use only workspaceSecrets → globalSecrets (dotfiles are safe-to-commit
 * and must never contain credentials; the dotfile loader enforces this).
 *
 * Pure — no I/O, no VS Code deps. Any field absent across all layers resolves to
 * undefined (or a hardcoded default for `codebaseIndexEnabled` and
 * `codebaseIndexEmbedderProvider`).
 *
 * Empty-string values in any layer are treated as "field not set" so that clearing
 * a URL in the workspace settings falls through to global instead of pinning "".
 */
export function resolveCodeIndexConfig(inputs: ResolverInputs): ResolverOutput {
	const projectDotfile = inputs.projectDotfile ?? undefined
	const globalDotfile = inputs.globalDotfile ?? undefined
	const workspaceConfig = inputs.workspaceConfig ?? undefined
	const globalConfig = inputs.globalConfig ?? undefined
	const workspaceSecrets = inputs.workspaceSecrets ?? undefined
	const globalSecrets = inputs.globalSecrets ?? undefined

	const sources: ResolvedConfigSources = {}
	const out: Partial<ResolvedCodeIndexConfig> = {}

	for (const field of NON_SECRET_FIELDS) {
		const pick = pickFirst<unknown>([
			{ source: "project-dotfile", value: valueAt(projectDotfile, field) },
			{ source: "global-dotfile", value: valueAt(globalDotfile, field) },
			{ source: "workspace", value: valueAt(workspaceConfig, field) },
			{ source: "global", value: valueAt(globalConfig, field) },
		])
		if (pick.value !== undefined) {
			assignField(out, field, pick.value)
			sources[field] = pick.source
		}
	}

	for (const field of CODEBASE_INDEX_SECRET_FIELDS) {
		const pick = pickFirst<unknown>([
			{ source: "workspace", value: valueAt(workspaceSecrets, field) },
			{ source: "global", value: valueAt(globalSecrets, field) },
		])
		if (pick.value !== undefined) {
			assignField(out, field, pick.value)
			sources[field] = pick.source
		}
	}

	if (out.codebaseIndexEnabled === undefined) {
		out.codebaseIndexEnabled = false
		sources.codebaseIndexEnabled = "default"
	}
	if (out.codebaseIndexEmbedderProvider === undefined) {
		out.codebaseIndexEmbedderProvider = "openai"
		sources.codebaseIndexEmbedderProvider = "default"
	}

	return { config: out as ResolvedCodeIndexConfig, sources }
}

/**
 * Field accessor. Coerces empty strings to `undefined` so that workspace-state
 * "" doesn't out-rank a real value in a lower layer. Booleans (false) and
 * numbers (0) are preserved.
 */
function valueAt(obj: unknown, field: string): unknown {
	if (obj === undefined || obj === null) return undefined
	const value = (obj as Record<string, unknown>)[field]
	return value === "" ? undefined : value
}

function assignField(target: Partial<ResolvedCodeIndexConfig>, field: string, value: unknown): void {
	;(target as Record<string, unknown>)[field] = value
}

export const CODE_INDEX_NON_SECRET_FIELDS: readonly NonSecretField[] = NON_SECRET_FIELDS

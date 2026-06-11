import * as vscode from "vscode"

import {
	CODEBASE_INDEX_SECRET_FIELDS,
	type CodebaseIndexConfig,
	type CodebaseIndexDotfile,
	type CodebaseIndexProvider,
} from "@roo-code/types"

import { ApiHandlerOptions } from "../../shared/api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { EmbedderProvider } from "./interfaces/manager"
import { CodeIndexConfig, PreviousConfigSnapshot } from "./interfaces/config"
import { DEFAULT_SEARCH_MIN_SCORE, DEFAULT_MAX_SEARCH_RESULTS } from "./constants"
import { getDefaultModelId, getModelDimension, getModelScoreThreshold } from "../../shared/embeddingModels"
import { resolveCodeIndexConfig, type ResolvedCodeIndexConfig, type ResolvedConfigSources } from "./config-resolver"
import { formatDotfileWarning, loadGlobalDotfile, loadProjectDotfile, type DotfileWarning } from "./dotfile-loader"

/**
 * Workspace-scoped keys used to separate per-workspace overrides from global state.
 *
 * - workspace config lives in `ExtensionContext.workspaceState` under `codebaseIndexConfig:<folderUri>`
 * - workspace secrets live in `ExtensionContext.secrets` under `<secretField>:<folderUri>`
 *
 * Keying by the real folder URI (not fsPath) matches how `isWorkspaceEnabled`
 * namespacing already works in manager.ts, so remote/local schemes cannot collide.
 *
 * Note: workspace-scoped secrets are read/written through `context.secrets` directly,
 * bypassing ContextProxy's well-known-keys cache. Any other code path that reads a
 * code-index secret through the proxy sees only the GLOBAL value, not the workspace
 * override — workspace overrides are observed only via `CodeIndexConfigManager`.
 */
const workspaceConfigKey = (folderUri: vscode.Uri) => `codebaseIndexConfig:${folderUri.toString(true)}`
const workspaceSecretKey = (field: string, folderUri: vscode.Uri) => `${field}:${folderUri.toString(true)}`

/**
 * Manages configuration state and validation for the code indexing feature.
 * Handles loading, validating, and providing access to configuration values.
 */
export class CodeIndexConfigManager {
	private codebaseIndexEnabled: boolean = false
	private embedderProvider: EmbedderProvider = "openai"
	private modelId?: string
	private modelDimension?: number
	private openAiOptions?: ApiHandlerOptions
	private ollamaOptions?: ApiHandlerOptions
	private openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
	private geminiOptions?: { apiKey: string }
	private mistralOptions?: { apiKey: string }
	private vercelAiGatewayOptions?: { apiKey: string }
	private bedrockOptions?: { region: string; profile?: string }
	private openRouterOptions?: { apiKey: string; specificProvider?: string }
	private qdrantUrl?: string = "http://localhost:6333"
	private qdrantApiKey?: string
	private searchMinScore?: number
	private searchMaxResults?: number

	/** Per-field map of which storage layer supplied each resolved value. Populated on every load. */
	private _configSources: ResolvedConfigSources = {}
	/** Full resolved config (including secrets) as of the last load. Used by the webview state builder. */
	private _lastResolvedConfig: ResolvedCodeIndexConfig | null = null
	/** Workspace-scoped secret values. Filled asynchronously in loadConfiguration(); empty until then. */
	private _workspaceScopedSecrets: Partial<CodebaseIndexProvider> = {}
	/** Last-parsed project dotfile, if any. Filled asynchronously in loadConfiguration(). */
	private _projectDotfile: CodebaseIndexDotfile | null = null
	/** Last-parsed global dotfile, if any. Filled asynchronously in loadConfiguration(). */
	private _globalDotfile: CodebaseIndexDotfile | null = null
	/** Warnings from the most recent dotfile load; consumed once by the caller of loadConfiguration. */
	private _pendingDotfileWarnings: Array<{ filePath: string; warning: DotfileWarning }> = []

	/**
	 * When false, `_refreshDotfiles` becomes a no-op. Tests can pass `false` so the
	 * user's real `~/.roo/codebase-index.json` can't bleed into specs; production
	 * callers always leave the default `true`. Also flipped to `false` automatically
	 * by `_setDotfilesForTesting` so injected values aren't clobbered.
	 */
	private loadDotfilesFromDisk: boolean

	constructor(
		private readonly contextProxy: ContextProxy,
		private readonly context?: vscode.ExtensionContext,
		private readonly folderUri?: vscode.Uri,
		private readonly workspacePath?: string,
		loadDotfilesFromDisk: boolean = true,
	) {
		this.loadDotfilesFromDisk = loadDotfilesFromDisk
		// Initialize with current configuration to avoid false restart triggers.
		// Workspace-scoped secrets are NOT loaded here (requires async); they get layered
		// in on the first loadConfiguration() call. The first call may register a benign
		// "restart" if workspace secrets exist, but services aren't running yet on first init.
		this._loadAndSetConfiguration()
	}

	/**
	 * Gets the context proxy instance
	 */
	public getContextProxy(): ContextProxy {
		return this.contextProxy
	}

	/**
	 * Read workspace-scoped config (non-secret) from workspaceState. Synchronous.
	 * Returns null if there is no workspace override OR if context/folderUri aren't available.
	 */
	private _readWorkspaceConfig(): Partial<CodebaseIndexConfig> | null {
		if (!this.context || !this.folderUri) return null
		return this.context.workspaceState.get<Partial<CodebaseIndexConfig>>(workspaceConfigKey(this.folderUri)) ?? null
	}

	/**
	 * Collect every known global secret from the ContextProxy cache into a
	 * CodebaseIndexProvider-shaped object for the resolver to consume.
	 */
	private _readGlobalSecrets(): Partial<CodebaseIndexProvider> {
		const secrets: Partial<CodebaseIndexProvider> = {}
		for (const field of CODEBASE_INDEX_SECRET_FIELDS) {
			const value = this.contextProxy?.getSecret(field as never) as string | undefined
			if (value !== undefined && value !== "") {
				;(secrets as Record<string, string>)[field] = value
			}
		}
		return secrets
	}

	/**
	 * Async refresh of both dotfiles (project-local and user-global).
	 * Collects warnings for the caller to surface once per loadConfiguration.
	 *
	 * Skipped entirely when `loadDotfilesFromDisk` is false (default true; tests
	 * pass false) so the user's real `~/.roo/codebase-index.json` can't leak into
	 * spec state. Tests that exercise dotfile behavior should call
	 * `_setDotfilesForTesting` directly.
	 */
	private async _refreshDotfiles(): Promise<void> {
		this._pendingDotfileWarnings = []
		if (!this.loadDotfilesFromDisk) {
			return
		}
		if (this.workspacePath) {
			const project = await loadProjectDotfile(this.workspacePath)
			this._projectDotfile = project.data
			for (const warning of project.warnings) {
				this._pendingDotfileWarnings.push({ filePath: project.filePath, warning })
			}
		} else {
			this._projectDotfile = null
		}
		const global = await loadGlobalDotfile()
		this._globalDotfile = global.data
		for (const warning of global.warnings) {
			this._pendingDotfileWarnings.push({ filePath: global.filePath, warning })
		}
	}

	/**
	 * Test-only hook to inject dotfile layers without touching the filesystem.
	 * The production path always reads from disk via `_refreshDotfiles`.
	 * Also locks future `_refreshDotfiles` calls to no-op so the injected values
	 * survive a subsequent `loadConfiguration()`.
	 */
	public _setDotfilesForTesting(
		project: CodebaseIndexDotfile | null,
		global: CodebaseIndexDotfile | null = null,
	): void {
		this._projectDotfile = project
		this._globalDotfile = global
		this.loadDotfilesFromDisk = false
	}

	/**
	 * Consumes (and returns) warnings from the most recent dotfile refresh.
	 * The manager layer surfaces these as VS Code toasts exactly once per change.
	 */
	public drainDotfileWarnings(): string[] {
		const messages = this._pendingDotfileWarnings.map(({ filePath, warning }) =>
			formatDotfileWarning(filePath, warning),
		)
		this._pendingDotfileWarnings = []
		return messages
	}

	/**
	 * Async refresh of workspace-scoped secrets from VS Code SecretStorage.
	 * Called from loadConfiguration() before _loadAndSetConfiguration() runs.
	 */
	private async _refreshWorkspaceScopedSecrets(): Promise<void> {
		if (!this.context || !this.folderUri) {
			this._workspaceScopedSecrets = {}
			return
		}
		const entries = await Promise.all(
			CODEBASE_INDEX_SECRET_FIELDS.map(async (field) => {
				try {
					const value = await this.context!.secrets.get(workspaceSecretKey(field, this.folderUri!))
					return [field, value] as const
				} catch {
					return [field, undefined] as const
				}
			}),
		)
		const next: Partial<CodebaseIndexProvider> = {}
		for (const [field, value] of entries) {
			if (value !== undefined && value !== "") {
				;(next as Record<string, string>)[field] = value
			}
		}
		this._workspaceScopedSecrets = next
	}

	/**
	 * Private method that handles loading configuration from storage and updating instance variables.
	 * Resolves the effective config via the precedence chain:
	 *   projectDotfile → globalDotfile → workspaceState → globalState → defaults
	 *
	 * Workspace-scoped secrets must be refreshed via _refreshWorkspaceScopedSecrets()
	 * and dotfiles via _refreshDotfiles() before this is called in the async path;
	 * the sync constructor path just reads whatever is in the cache (initially empty).
	 */
	private _loadAndSetConfiguration(): void {
		const rawGlobalConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig") as
			| Partial<CodebaseIndexConfig>
			| undefined
		// When there is no global state at all (fresh install), fall back to a historical
		// defaults object. If global state exists but a field is absent, we leave it undefined
		// so higher layers (workspace) can set it — and so isConfigured() correctly
		// reports "not configured" rather than hiding behind a localhost default.
		const globalConfig: Partial<CodebaseIndexConfig> | undefined =
			rawGlobalConfig ??
			({
				codebaseIndexQdrantUrl: "http://localhost:6333",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexBedrockRegion: "us-east-1",
				codebaseIndexBedrockProfile: "",
			} as Partial<CodebaseIndexConfig>)
		const workspaceConfig = this._readWorkspaceConfig()
		const globalSecrets = this._readGlobalSecrets()
		const workspaceSecrets = this._workspaceScopedSecrets

		const { config, sources } = resolveCodeIndexConfig({
			projectDotfile: this._projectDotfile,
			globalDotfile: this._globalDotfile,
			workspaceConfig,
			globalConfig,
			workspaceSecrets,
			globalSecrets,
		})

		this._configSources = sources
		this._lastResolvedConfig = config

		this.codebaseIndexEnabled = config.codebaseIndexEnabled
		this.qdrantUrl = config.codebaseIndexQdrantUrl
		this.qdrantApiKey = config.codeIndexQdrantApiKey ?? ""
		this.searchMinScore = config.codebaseIndexSearchMinScore
		this.searchMaxResults = config.codebaseIndexSearchMaxResults

		// Validate and set model dimension
		const rawDimension = config.codebaseIndexEmbedderModelDimension
		if (rawDimension !== undefined && rawDimension !== null) {
			const dimension = Number(rawDimension)
			if (!isNaN(dimension) && dimension > 0) {
				this.modelDimension = dimension
			} else {
				console.warn(
					`Invalid codebaseIndexEmbedderModelDimension value: ${rawDimension}. Must be a positive number.`,
				)
				this.modelDimension = undefined
			}
		} else {
			this.modelDimension = undefined
		}

		this.openAiOptions = { openAiNativeApiKey: config.codeIndexOpenAiKey ?? "" }

		// Our resolver (resolveCodeIndexConfig) already normalizes the provider — invalid
		// or unset values default to "openai" (config-resolver.ts) — and the resolved type
		// includes "semble", so the direct assignment carries every provider (incl. the new
		// upstream "semble" option) through without the per-provider if/else chain.
		this.embedderProvider = config.codebaseIndexEmbedderProvider
		this.modelId = config.codebaseIndexEmbedderModelId || undefined

		this.ollamaOptions = { ollamaBaseUrl: config.codebaseIndexEmbedderBaseUrl }

		const openAiCompatibleBaseUrl = config.codebaseIndexOpenAiCompatibleBaseUrl ?? ""
		const openAiCompatibleApiKey = config.codebaseIndexOpenAiCompatibleApiKey ?? ""
		this.openAiCompatibleOptions =
			openAiCompatibleBaseUrl && openAiCompatibleApiKey
				? { baseUrl: openAiCompatibleBaseUrl, apiKey: openAiCompatibleApiKey }
				: undefined

		this.geminiOptions = config.codebaseIndexGeminiApiKey ? { apiKey: config.codebaseIndexGeminiApiKey } : undefined
		this.mistralOptions = config.codebaseIndexMistralApiKey
			? { apiKey: config.codebaseIndexMistralApiKey }
			: undefined
		this.vercelAiGatewayOptions = config.codebaseIndexVercelAiGatewayApiKey
			? { apiKey: config.codebaseIndexVercelAiGatewayApiKey }
			: undefined
		this.openRouterOptions = config.codebaseIndexOpenRouterApiKey
			? {
					apiKey: config.codebaseIndexOpenRouterApiKey,
					specificProvider: config.codebaseIndexOpenRouterSpecificProvider || undefined,
				}
			: undefined

		// Preserve historical behavior: bedrock region defaults to "us-east-1" if nothing supplies one.
		const bedrockRegion = config.codebaseIndexBedrockRegion ?? "us-east-1"
		const bedrockProfile = config.codebaseIndexBedrockProfile ?? ""
		this.bedrockOptions = { region: bedrockRegion, profile: bedrockProfile || undefined }
	}

	/**
	 * Loads persisted configuration from globalState.
	 */
	public async loadConfiguration(): Promise<{
		configSnapshot: PreviousConfigSnapshot
		currentConfig: {
			isConfigured: boolean
			embedderProvider: EmbedderProvider
			modelId?: string
			modelDimension?: number
			openAiOptions?: ApiHandlerOptions
			ollamaOptions?: ApiHandlerOptions
			openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
			geminiOptions?: { apiKey: string }
			mistralOptions?: { apiKey: string }
			vercelAiGatewayOptions?: { apiKey: string }
			bedrockOptions?: { region: string; profile?: string }
			openRouterOptions?: { apiKey: string }
			qdrantUrl?: string
			qdrantApiKey?: string
			searchMinScore?: number
		}
		requiresRestart: boolean
	}> {
		// Capture the ACTUAL previous state before loading new configuration
		const previousConfigSnapshot: PreviousConfigSnapshot = {
			enabled: this.codebaseIndexEnabled,
			configured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			modelDimension: this.modelDimension,
			openAiKey: this.openAiOptions?.openAiNativeApiKey ?? "",
			ollamaBaseUrl: this.ollamaOptions?.ollamaBaseUrl ?? "",
			openAiCompatibleBaseUrl: this.openAiCompatibleOptions?.baseUrl ?? "",
			openAiCompatibleApiKey: this.openAiCompatibleOptions?.apiKey ?? "",
			geminiApiKey: this.geminiOptions?.apiKey ?? "",
			mistralApiKey: this.mistralOptions?.apiKey ?? "",
			vercelAiGatewayApiKey: this.vercelAiGatewayOptions?.apiKey ?? "",
			bedrockRegion: this.bedrockOptions?.region ?? "",
			bedrockProfile: this.bedrockOptions?.profile ?? "",
			openRouterApiKey: this.openRouterOptions?.apiKey ?? "",
			openRouterSpecificProvider: this.openRouterOptions?.specificProvider ?? "",
			qdrantUrl: this.qdrantUrl ?? "",
			qdrantApiKey: this.qdrantApiKey ?? "",
		}

		// Refresh secrets from VSCode storage to ensure we have the latest values
		await this.contextProxy.refreshSecrets()
		await this._refreshWorkspaceScopedSecrets()
		await this._refreshDotfiles()

		// Load new configuration from storage and update instance variables
		this._loadAndSetConfiguration()

		const requiresRestart = this.doesConfigChangeRequireRestart(previousConfigSnapshot)

		return {
			configSnapshot: previousConfigSnapshot,
			currentConfig: {
				isConfigured: this.isConfigured(),
				embedderProvider: this.embedderProvider,
				modelId: this.modelId,
				modelDimension: this.modelDimension,
				openAiOptions: this.openAiOptions,
				ollamaOptions: this.ollamaOptions,
				openAiCompatibleOptions: this.openAiCompatibleOptions,
				geminiOptions: this.geminiOptions,
				mistralOptions: this.mistralOptions,
				vercelAiGatewayOptions: this.vercelAiGatewayOptions,
				bedrockOptions: this.bedrockOptions,
				openRouterOptions: this.openRouterOptions,
				qdrantUrl: this.qdrantUrl,
				qdrantApiKey: this.qdrantApiKey,
				searchMinScore: this.currentSearchMinScore,
			},
			requiresRestart,
		}
	}

	/**
	 * Checks if the service is properly configured based on the embedder type.
	 */
	public isConfigured(): boolean {
		if (this.embedderProvider === "semble") {
			// Semble requires no API keys or Qdrant — it's always configured
			return true
		}

		if (this.embedderProvider === "openai") {
			const openAiKey = this.openAiOptions?.openAiNativeApiKey
			const qdrantUrl = this.qdrantUrl
			return !!(openAiKey && qdrantUrl)
		} else if (this.embedderProvider === "ollama") {
			// Ollama model ID has a default, so only base URL is strictly required for config
			const ollamaBaseUrl = this.ollamaOptions?.ollamaBaseUrl
			const qdrantUrl = this.qdrantUrl
			return !!(ollamaBaseUrl && qdrantUrl)
		} else if (this.embedderProvider === "openai-compatible") {
			const baseUrl = this.openAiCompatibleOptions?.baseUrl
			const apiKey = this.openAiCompatibleOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(baseUrl && apiKey && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "gemini") {
			const apiKey = this.geminiOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(apiKey && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "mistral") {
			const apiKey = this.mistralOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(apiKey && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "vercel-ai-gateway") {
			const apiKey = this.vercelAiGatewayOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(apiKey && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "bedrock") {
			// Only region is required for Bedrock (profile is optional)
			const region = this.bedrockOptions?.region
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(region && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "openrouter") {
			const apiKey = this.openRouterOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(apiKey && qdrantUrl)
			return isConfigured
		}
		return false // Should not happen if embedderProvider is always set correctly
	}

	/**
	 * Determines if a configuration change requires restarting the indexing process.
	 * Simplified logic: only restart for critical changes that affect service functionality.
	 *
	 * CRITICAL CHANGES (require restart):
	 * - Provider changes (openai -> ollama, etc.)
	 * - Authentication changes (API keys, base URLs)
	 * - Vector dimension changes (model changes that affect embedding size)
	 * - Qdrant connection changes (URL, API key)
	 * - Feature enable/disable transitions
	 *
	 * MINOR CHANGES (no restart needed):
	 * - Search minimum score adjustments
	 * - UI-only settings
	 * - Non-functional configuration tweaks
	 */
	doesConfigChangeRequireRestart(prev: PreviousConfigSnapshot): boolean {
		const nowConfigured = this.isConfigured()

		// Handle null/undefined values safely
		const prevEnabled = prev?.enabled ?? false
		const prevConfigured = prev?.configured ?? false
		const prevProvider = prev?.embedderProvider ?? "openai"
		const prevOpenAiKey = prev?.openAiKey ?? ""
		const prevOllamaBaseUrl = prev?.ollamaBaseUrl ?? ""
		const prevOpenAiCompatibleBaseUrl = prev?.openAiCompatibleBaseUrl ?? ""
		const prevOpenAiCompatibleApiKey = prev?.openAiCompatibleApiKey ?? ""
		const prevModelDimension = prev?.modelDimension
		const prevGeminiApiKey = prev?.geminiApiKey ?? ""
		const prevMistralApiKey = prev?.mistralApiKey ?? ""
		const prevVercelAiGatewayApiKey = prev?.vercelAiGatewayApiKey ?? ""
		const prevBedrockRegion = prev?.bedrockRegion ?? ""
		const prevBedrockProfile = prev?.bedrockProfile ?? ""
		const prevOpenRouterApiKey = prev?.openRouterApiKey ?? ""
		const prevOpenRouterSpecificProvider = prev?.openRouterSpecificProvider ?? ""
		const prevQdrantUrl = prev?.qdrantUrl ?? ""
		const prevQdrantApiKey = prev?.qdrantApiKey ?? ""

		// 1. Transition from disabled/unconfigured to enabled/configured
		if ((!prevEnabled || !prevConfigured) && this.codebaseIndexEnabled && nowConfigured) {
			return true
		}

		// 2. Transition from enabled to disabled
		if (prevEnabled && !this.codebaseIndexEnabled) {
			return true
		}

		// 3. If wasn't ready before and isn't ready now, no restart needed
		if ((!prevEnabled || !prevConfigured) && (!this.codebaseIndexEnabled || !nowConfigured)) {
			return false
		}

		// 4. CRITICAL CHANGES - Always restart for these
		// Only check for critical changes if feature is enabled
		if (!this.codebaseIndexEnabled) {
			return false
		}

		// Provider change
		if (prevProvider !== this.embedderProvider) {
			return true
		}

		// Authentication changes (API keys)
		const currentOpenAiKey = this.openAiOptions?.openAiNativeApiKey ?? ""
		const currentOllamaBaseUrl = this.ollamaOptions?.ollamaBaseUrl ?? ""
		const currentOpenAiCompatibleBaseUrl = this.openAiCompatibleOptions?.baseUrl ?? ""
		const currentOpenAiCompatibleApiKey = this.openAiCompatibleOptions?.apiKey ?? ""
		const currentModelDimension = this.modelDimension
		const currentGeminiApiKey = this.geminiOptions?.apiKey ?? ""
		const currentMistralApiKey = this.mistralOptions?.apiKey ?? ""
		const currentVercelAiGatewayApiKey = this.vercelAiGatewayOptions?.apiKey ?? ""
		const currentBedrockRegion = this.bedrockOptions?.region ?? ""
		const currentBedrockProfile = this.bedrockOptions?.profile ?? ""
		const currentOpenRouterApiKey = this.openRouterOptions?.apiKey ?? ""
		const currentOpenRouterSpecificProvider = this.openRouterOptions?.specificProvider ?? ""
		const currentQdrantUrl = this.qdrantUrl ?? ""
		const currentQdrantApiKey = this.qdrantApiKey ?? ""

		if (prevOpenAiKey !== currentOpenAiKey) {
			return true
		}

		if (prevOllamaBaseUrl !== currentOllamaBaseUrl) {
			return true
		}

		if (
			prevOpenAiCompatibleBaseUrl !== currentOpenAiCompatibleBaseUrl ||
			prevOpenAiCompatibleApiKey !== currentOpenAiCompatibleApiKey
		) {
			return true
		}

		if (prevGeminiApiKey !== currentGeminiApiKey) {
			return true
		}

		if (prevMistralApiKey !== currentMistralApiKey) {
			return true
		}

		if (prevVercelAiGatewayApiKey !== currentVercelAiGatewayApiKey) {
			return true
		}

		if (prevBedrockRegion !== currentBedrockRegion || prevBedrockProfile !== currentBedrockProfile) {
			return true
		}

		if (prevOpenRouterApiKey !== currentOpenRouterApiKey) {
			return true
		}

		// OpenRouter specific provider change
		if (prevOpenRouterSpecificProvider !== currentOpenRouterSpecificProvider) {
			return true
		}

		// Check for model dimension changes (generic for all providers)
		if (prevModelDimension !== currentModelDimension) {
			return true
		}

		if (prevQdrantUrl !== currentQdrantUrl || prevQdrantApiKey !== currentQdrantApiKey) {
			return true
		}

		// Vector dimension changes (still important for compatibility)
		if (this._hasVectorDimensionChanged(prevProvider, prev?.modelId)) {
			return true
		}

		return false
	}

	/**
	 * Checks if model changes result in vector dimension changes that require restart.
	 */
	private _hasVectorDimensionChanged(prevProvider: EmbedderProvider, prevModelId?: string): boolean {
		const currentProvider = this.embedderProvider
		const currentModelId = this.modelId ?? getDefaultModelId(currentProvider)
		const resolvedPrevModelId = prevModelId ?? getDefaultModelId(prevProvider)

		// If model IDs are the same and provider is the same, no dimension change
		if (prevProvider === currentProvider && resolvedPrevModelId === currentModelId) {
			return false
		}

		// Get vector dimensions for both models
		const prevDimension = getModelDimension(prevProvider, resolvedPrevModelId)
		const currentDimension = getModelDimension(currentProvider, currentModelId)

		// If we can't determine dimensions, be safe and restart
		if (prevDimension === undefined || currentDimension === undefined) {
			return true
		}

		// Only restart if dimensions actually changed
		return prevDimension !== currentDimension
	}

	/**
	 * Gets the current configuration state.
	 */
	public getConfig(): CodeIndexConfig {
		return {
			isConfigured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			modelDimension: this.modelDimension,
			openAiOptions: this.openAiOptions,
			ollamaOptions: this.ollamaOptions,
			openAiCompatibleOptions: this.openAiCompatibleOptions,
			geminiOptions: this.geminiOptions,
			mistralOptions: this.mistralOptions,
			vercelAiGatewayOptions: this.vercelAiGatewayOptions,
			bedrockOptions: this.bedrockOptions,
			openRouterOptions: this.openRouterOptions,
			qdrantUrl: this.qdrantUrl,
			qdrantApiKey: this.qdrantApiKey,
			searchMinScore: this.currentSearchMinScore,
			searchMaxResults: this.currentSearchMaxResults,
		}
	}

	/**
	 * Gets whether the code indexing feature is enabled
	 */
	public get isFeatureEnabled(): boolean {
		return this.codebaseIndexEnabled
	}

	/**
	 * Gets whether the code indexing feature is properly configured
	 */
	public get isFeatureConfigured(): boolean {
		return this.isConfigured()
	}

	/**
	 * Gets the current embedder type (openai or ollama)
	 */
	public get currentEmbedderProvider(): EmbedderProvider {
		return this.embedderProvider
	}

	/**
	 * Gets the current Qdrant configuration
	 */
	public get qdrantConfig(): { url?: string; apiKey?: string } {
		return {
			url: this.qdrantUrl,
			apiKey: this.qdrantApiKey,
		}
	}

	/**
	 * Gets the current model ID being used for embeddings.
	 */
	public get currentModelId(): string | undefined {
		return this.modelId
	}

	/**
	 * Gets the current model dimension being used for embeddings.
	 * Returns the model's built-in dimension if available, otherwise falls back to custom dimension.
	 */
	public get currentModelDimension(): number | undefined {
		// First try to get the model-specific dimension
		const modelId = this.modelId ?? getDefaultModelId(this.embedderProvider)
		const modelDimension = getModelDimension(this.embedderProvider, modelId)

		// Only use custom dimension if model doesn't have a built-in dimension
		if (!modelDimension && this.modelDimension && this.modelDimension > 0) {
			return this.modelDimension
		}

		return modelDimension
	}

	/**
	 * Gets the configured minimum search score based on user setting, model-specific threshold, or fallback.
	 * Priority: 1) User setting, 2) Model-specific threshold, 3) Default DEFAULT_SEARCH_MIN_SCORE constant.
	 */
	public get currentSearchMinScore(): number {
		// First check if user has configured a custom score threshold
		if (this.searchMinScore !== undefined) {
			return this.searchMinScore
		}

		// Fall back to model-specific threshold
		const currentModelId = this.modelId ?? getDefaultModelId(this.embedderProvider)
		const modelSpecificThreshold = getModelScoreThreshold(this.embedderProvider, currentModelId)
		return modelSpecificThreshold ?? DEFAULT_SEARCH_MIN_SCORE
	}

	/**
	 * Gets the configured maximum search results.
	 * Returns user setting if configured, otherwise returns default.
	 */
	public get currentSearchMaxResults(): number {
		return this.searchMaxResults ?? DEFAULT_MAX_SEARCH_RESULTS
	}

	/**
	 * Per-field map of which storage layer supplied each resolved value.
	 * Used by the UI to render "pinned by .roo/codebase-index.json" badges (phase 4).
	 * Returns a snapshot; mutating the returned object does not affect state.
	 */
	public getConfigSources(): ResolvedConfigSources {
		return { ...this._configSources }
	}

	/**
	 * The full resolved config from the last load, or null if load hasn't happened.
	 * Returned object may be frozen by callers; treat as read-only.
	 */
	public getLastResolvedConfig(): ResolvedCodeIndexConfig | null {
		return this._lastResolvedConfig
	}
}

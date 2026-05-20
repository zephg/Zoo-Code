// npx vitest services/code-index/__tests__/config-resolver.spec.ts

import { resolveCodeIndexConfig } from "../config-resolver"

describe("resolveCodeIndexConfig", () => {
	describe("empty inputs", () => {
		it("returns hard defaults when everything is empty", () => {
			const result = resolveCodeIndexConfig({})
			expect(result.config.codebaseIndexEnabled).toBe(false)
			expect(result.config.codebaseIndexEmbedderProvider).toBe("openai")
			expect(result.config.codebaseIndexQdrantUrl).toBeUndefined()
			expect(result.sources.codebaseIndexEnabled).toBe("default")
			expect(result.sources.codebaseIndexEmbedderProvider).toBe("default")
		})

		it("treats null layers identically to undefined", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: null,
				globalDotfile: null,
				workspaceConfig: null,
				globalConfig: null,
				workspaceSecrets: null,
				globalSecrets: null,
			})
			expect(result.config.codebaseIndexEnabled).toBe(false)
			expect(result.sources.codebaseIndexEnabled).toBe("default")
		})
	})

	describe("precedence — non-secrets", () => {
		it("project dotfile beats global dotfile beats workspace beats global", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: { codebaseIndexQdrantUrl: "http://project:6333" },
				globalDotfile: { codebaseIndexQdrantUrl: "http://global-dotfile:6333" },
				workspaceConfig: { codebaseIndexQdrantUrl: "http://workspace:6333" },
				globalConfig: { codebaseIndexQdrantUrl: "http://global:6333" },
			})
			expect(result.config.codebaseIndexQdrantUrl).toBe("http://project:6333")
			expect(result.sources.codebaseIndexQdrantUrl).toBe("project-dotfile")
		})

		it("global dotfile wins when project dotfile absent for that field", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: { codebaseIndexEmbedderModelId: "text-embedding-3-small" },
				globalDotfile: { codebaseIndexQdrantUrl: "http://global-dotfile:6333" },
				globalConfig: { codebaseIndexQdrantUrl: "http://global:6333" },
			})
			expect(result.config.codebaseIndexQdrantUrl).toBe("http://global-dotfile:6333")
			expect(result.sources.codebaseIndexQdrantUrl).toBe("global-dotfile")
			expect(result.config.codebaseIndexEmbedderModelId).toBe("text-embedding-3-small")
			expect(result.sources.codebaseIndexEmbedderModelId).toBe("project-dotfile")
		})

		it("workspace beats global when dotfiles absent", () => {
			const result = resolveCodeIndexConfig({
				workspaceConfig: { codebaseIndexQdrantUrl: "http://workspace:6333" },
				globalConfig: { codebaseIndexQdrantUrl: "http://global:6333" },
			})
			expect(result.config.codebaseIndexQdrantUrl).toBe("http://workspace:6333")
			expect(result.sources.codebaseIndexQdrantUrl).toBe("workspace")
		})

		it("global used when only global is set", () => {
			const result = resolveCodeIndexConfig({
				globalConfig: { codebaseIndexQdrantUrl: "http://global:6333" },
			})
			expect(result.config.codebaseIndexQdrantUrl).toBe("http://global:6333")
			expect(result.sources.codebaseIndexQdrantUrl).toBe("global")
		})

		it("per-field origin can differ within a single resolve", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: { codebaseIndexQdrantUrl: "http://project:6333" },
				workspaceConfig: { codebaseIndexEmbedderModelId: "model-from-ws" },
				globalConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "ollama",
				},
			})
			expect(result.sources.codebaseIndexQdrantUrl).toBe("project-dotfile")
			expect(result.sources.codebaseIndexEmbedderModelId).toBe("workspace")
			expect(result.sources.codebaseIndexEnabled).toBe("global")
			expect(result.sources.codebaseIndexEmbedderProvider).toBe("global")
		})
	})

	describe("empty-string fallthrough", () => {
		it("workspace empty URL falls through to global non-empty (no '' pinning)", () => {
			const result = resolveCodeIndexConfig({
				workspaceConfig: { codebaseIndexQdrantUrl: "" },
				globalConfig: { codebaseIndexQdrantUrl: "http://global:6333" },
			})
			expect(result.config.codebaseIndexQdrantUrl).toBe("http://global:6333")
			expect(result.sources.codebaseIndexQdrantUrl).toBe("global")
		})

		it("preserves false (not coerced as empty)", () => {
			const result = resolveCodeIndexConfig({
				workspaceConfig: { codebaseIndexEnabled: false },
				globalConfig: { codebaseIndexEnabled: true },
			})
			expect(result.config.codebaseIndexEnabled).toBe(false)
			expect(result.sources.codebaseIndexEnabled).toBe("workspace")
		})

		it("preserves 0 (not coerced as empty)", () => {
			const result = resolveCodeIndexConfig({
				workspaceConfig: { codebaseIndexSearchMinScore: 0 },
				globalConfig: { codebaseIndexSearchMinScore: 0.5 },
			})
			expect(result.config.codebaseIndexSearchMinScore).toBe(0)
			expect(result.sources.codebaseIndexSearchMinScore).toBe("workspace")
		})
	})

	describe("dotfile disable-flag semantics", () => {
		it("project dotfile with codebaseIndexEnabled=false overrides a globally-enabled setting", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: { codebaseIndexEnabled: false },
				globalConfig: { codebaseIndexEnabled: true, codebaseIndexQdrantUrl: "http://global:6333" },
			})
			expect(result.config.codebaseIndexEnabled).toBe(false)
			expect(result.sources.codebaseIndexEnabled).toBe("project-dotfile")
		})

		it("dotfile not setting the flag falls through to global truth", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: { codebaseIndexQdrantUrl: "http://project:6333" },
				globalConfig: { codebaseIndexEnabled: true },
			})
			expect(result.config.codebaseIndexEnabled).toBe(true)
			expect(result.sources.codebaseIndexEnabled).toBe("global")
		})
	})

	describe("secrets", () => {
		it("workspace secrets override global secrets", () => {
			const result = resolveCodeIndexConfig({
				workspaceSecrets: { codeIndexQdrantApiKey: "ws-key" },
				globalSecrets: { codeIndexQdrantApiKey: "global-key" },
			})
			expect(result.config.codeIndexQdrantApiKey).toBe("ws-key")
			expect(result.sources.codeIndexQdrantApiKey).toBe("workspace")
		})

		it("falls back to global secret when workspace secret empty string", () => {
			const result = resolveCodeIndexConfig({
				workspaceSecrets: { codeIndexQdrantApiKey: "" },
				globalSecrets: { codeIndexQdrantApiKey: "global-key" },
			})
			expect(result.config.codeIndexQdrantApiKey).toBe("global-key")
			expect(result.sources.codeIndexQdrantApiKey).toBe("global")
		})

		it("dotfile never contributes to secret fields even if it somehow has them (loader is the gate)", () => {
			// The dotfile schema is .strict() so this object would never parse, but guard anyway.
			const tainted = { codeIndexQdrantApiKey: "should-be-ignored" } as unknown as Parameters<
				typeof resolveCodeIndexConfig
			>[0]["projectDotfile"]
			const result = resolveCodeIndexConfig({
				projectDotfile: tainted,
				globalSecrets: { codeIndexQdrantApiKey: "global-key" },
			})
			expect(result.config.codeIndexQdrantApiKey).toBe("global-key")
			expect(result.sources.codeIndexQdrantApiKey).toBe("global")
		})

		it("secrets absent yield undefined value and no source entry", () => {
			const result = resolveCodeIndexConfig({})
			expect(result.config.codeIndexQdrantApiKey).toBeUndefined()
			expect(result.sources.codeIndexQdrantApiKey).toBeUndefined()
		})
	})

	describe("source-of-truth propagation", () => {
		it("every populated non-secret field reports a source", () => {
			const result = resolveCodeIndexConfig({
				projectDotfile: {
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://p:6333",
					codebaseIndexEmbedderProvider: "ollama",
					codebaseIndexEmbedderBaseUrl: "http://ollama:11434",
					codebaseIndexEmbedderModelId: "nomic-embed-text",
					codebaseIndexEmbedderModelDimension: 768,
					codebaseIndexSearchMinScore: 0.3,
					codebaseIndexSearchMaxResults: 20,
					codebaseIndexOpenAiCompatibleBaseUrl: "http://compat:1234",
					codebaseIndexOpenAiCompatibleModelDimension: 1024,
					codebaseIndexBedrockRegion: "us-east-1",
					codebaseIndexBedrockProfile: "dev",
					codebaseIndexOpenRouterSpecificProvider: "anthropic",
				},
			})
			const expected = [
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
			for (const field of expected) {
				expect(result.sources[field]).toBe("project-dotfile")
			}
		})
	})
})

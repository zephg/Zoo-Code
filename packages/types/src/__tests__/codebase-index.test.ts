import { describe, it, expect } from "vitest"
import {
	codebaseIndexDotfileSchema,
	codebaseIndexWorkspaceConfigSchema,
	CODEBASE_INDEX_SECRET_FIELDS,
} from "../codebase-index.js"

describe("codebase-index schemas", () => {
	describe("codebaseIndexDotfileSchema", () => {
		it("accepts an empty object", () => {
			expect(codebaseIndexDotfileSchema.safeParse({}).success).toBe(true)
		})

		it("accepts $schema field (for editor autocomplete)", () => {
			const result = codebaseIndexDotfileSchema.safeParse({
				$schema: "https://example.com/codebase-index.schema.json",
				codebaseIndexQdrantUrl: "http://localhost:6333",
			})
			expect(result.success).toBe(true)
		})

		it("accepts all allowed non-secret fields", () => {
			const result = codebaseIndexDotfileSchema.safeParse({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.team:6333",
				codebaseIndexEmbedderProvider: "ollama",
				codebaseIndexEmbedderBaseUrl: "http://ollama:11434",
				codebaseIndexEmbedderModelId: "nomic-embed-text",
				codebaseIndexEmbedderModelDimension: 768,
				codebaseIndexSearchMinScore: 0.4,
				codebaseIndexSearchMaxResults: 50,
				codebaseIndexOpenAiCompatibleBaseUrl: "http://compat:1234",
				codebaseIndexOpenAiCompatibleModelDimension: 1024,
				codebaseIndexBedrockRegion: "us-east-1",
				codebaseIndexBedrockProfile: "dev",
				codebaseIndexOpenRouterSpecificProvider: "anthropic",
			})
			expect(result.success).toBe(true)
		})

		it.each(CODEBASE_INDEX_SECRET_FIELDS)(
			"rejects dotfile containing the secret field %s (strict)",
			(secretField) => {
				const result = codebaseIndexDotfileSchema.safeParse({
					[secretField]: "would-be-exposed-if-committed",
				})
				expect(result.success).toBe(false)
			},
		)

		it("rejects unknown keys (strict)", () => {
			const result = codebaseIndexDotfileSchema.safeParse({ notARealField: 1 })
			expect(result.success).toBe(false)
		})

		it("rejects invalid embedder provider values", () => {
			const result = codebaseIndexDotfileSchema.safeParse({
				codebaseIndexEmbedderProvider: "anthropic-claude",
			})
			expect(result.success).toBe(false)
		})

		it("rejects search min score out of range", () => {
			expect(codebaseIndexDotfileSchema.safeParse({ codebaseIndexSearchMinScore: -0.1 }).success).toBe(false)
			expect(codebaseIndexDotfileSchema.safeParse({ codebaseIndexSearchMinScore: 1.5 }).success).toBe(false)
			expect(codebaseIndexDotfileSchema.safeParse({ codebaseIndexSearchMinScore: 0 }).success).toBe(true)
			expect(codebaseIndexDotfileSchema.safeParse({ codebaseIndexSearchMinScore: 1 }).success).toBe(true)
		})
	})

	describe("codebaseIndexWorkspaceConfigSchema", () => {
		it("is the same shape as the global config (all fields optional)", () => {
			const result = codebaseIndexWorkspaceConfigSchema.safeParse({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://ws:6333",
			})
			expect(result.success).toBe(true)
		})

		it("accepts empty", () => {
			expect(codebaseIndexWorkspaceConfigSchema.safeParse({}).success).toBe(true)
		})
	})
})

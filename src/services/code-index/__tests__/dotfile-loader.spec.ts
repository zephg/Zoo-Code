// npx vitest services/code-index/__tests__/dotfile-loader.spec.ts

import * as path from "path"
import * as os from "os"
import fs from "fs/promises"

import {
	loadCodebaseIndexDotfile,
	loadProjectDotfile,
	loadGlobalDotfile,
	formatDotfileWarning,
	getProjectDotfilePath,
	getGlobalDotfilePath,
	CODEBASE_INDEX_DOTFILE_FILENAME,
} from "../dotfile-loader"

describe("dotfile-loader", () => {
	let tmpRoot: string

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codebase-index-dotfile-"))
	})

	afterEach(async () => {
		await fs.rm(tmpRoot, { recursive: true, force: true })
	})

	const writeDotfile = async (body: string) => {
		const dir = path.join(tmpRoot, ".roo")
		await fs.mkdir(dir, { recursive: true })
		const file = path.join(dir, CODEBASE_INDEX_DOTFILE_FILENAME)
		await fs.writeFile(file, body, "utf-8")
		return file
	}

	describe("getProjectDotfilePath", () => {
		it("returns {cwd}/.roo/codebase-index.json", () => {
			expect(getProjectDotfilePath("/tmp/project")).toBe(path.join("/tmp/project", ".roo", "codebase-index.json"))
		})
	})

	describe("getGlobalDotfilePath", () => {
		it("returns {home}/.roo/codebase-index.json", () => {
			expect(getGlobalDotfilePath()).toBe(path.join(os.homedir(), ".roo", "codebase-index.json"))
		})
	})

	describe("loadCodebaseIndexDotfile", () => {
		it("returns data=null, exists=false, no warnings when the file does not exist", async () => {
			const missing = path.join(tmpRoot, ".roo", "codebase-index.json")
			const result = await loadCodebaseIndexDotfile(missing)
			expect(result).toEqual({ data: null, warnings: [], filePath: missing, exists: false })
		})

		it("parses a minimal valid dotfile", async () => {
			const file = await writeDotfile(
				JSON.stringify({
					codebaseIndexQdrantUrl: "http://team-qdrant.internal:6333",
				}),
			)
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.exists).toBe(true)
			expect(result.warnings).toHaveLength(0)
			expect(result.data).toEqual({
				codebaseIndexQdrantUrl: "http://team-qdrant.internal:6333",
			})
		})

		it("accepts a $schema field without warnings", async () => {
			const file = await writeDotfile(
				JSON.stringify({
					$schema: "https://example.com/schema.json",
					codebaseIndexEnabled: true,
				}),
			)
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.warnings).toHaveLength(0)
			expect(result.data?.codebaseIndexEnabled).toBe(true)
		})

		it("strips secret fields and warns (but still returns valid data for the rest)", async () => {
			const file = await writeDotfile(
				JSON.stringify({
					codebaseIndexQdrantUrl: "http://q:6333",
					codeIndexQdrantApiKey: "leaked",
					codebaseIndexOpenRouterApiKey: "also-leaked",
				}),
			)
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.data).toEqual({
				codebaseIndexQdrantUrl: "http://q:6333",
			})
			expect(result.warnings).toHaveLength(1)
			const warning = result.warnings[0]
			expect(warning.type).toBe("secrets-rejected")
			if (warning.type === "secrets-rejected") {
				expect(warning.fields.sort()).toEqual(["codeIndexQdrantApiKey", "codebaseIndexOpenRouterApiKey"].sort())
			}
		})

		it("rejects unknown (non-secret) fields via the strict schema", async () => {
			const file = await writeDotfile(JSON.stringify({ codebaseIndexQdrntUrl: "typo" }))
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.data).toBeNull()
			expect(result.warnings.some((w) => w.type === "schema-error")).toBe(true)
		})

		it("reports parse errors for invalid JSON", async () => {
			const file = await writeDotfile("{ this is not json")
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.data).toBeNull()
			expect(result.warnings.some((w) => w.type === "parse-error")).toBe(true)
		})

		it("reports parse errors for non-object roots", async () => {
			const file = await writeDotfile(JSON.stringify(["unexpected", "array"]))
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.data).toBeNull()
			expect(result.warnings.some((w) => w.type === "parse-error")).toBe(true)
		})

		it("reports schema errors with a helpful path+message", async () => {
			const file = await writeDotfile(JSON.stringify({ codebaseIndexSearchMinScore: 2 }))
			const result = await loadCodebaseIndexDotfile(file)
			expect(result.data).toBeNull()
			const schemaErr = result.warnings.find((w) => w.type === "schema-error")
			expect(schemaErr).toBeDefined()
			if (schemaErr?.type === "schema-error") {
				expect(schemaErr.message).toContain("codebaseIndexSearchMinScore")
			}
		})
	})

	describe("loadProjectDotfile", () => {
		it("reads from {workspace}/.roo/codebase-index.json", async () => {
			await writeDotfile(JSON.stringify({ codebaseIndexQdrantUrl: "http://p:6333" }))
			const result = await loadProjectDotfile(tmpRoot)
			expect(result.exists).toBe(true)
			expect(result.data?.codebaseIndexQdrantUrl).toBe("http://p:6333")
		})

		it("returns exists=false when the project dotfile is missing", async () => {
			const result = await loadProjectDotfile(tmpRoot)
			expect(result.exists).toBe(false)
			expect(result.data).toBeNull()
		})
	})

	describe("loadGlobalDotfile", () => {
		it("reads from {homedir}/.roo/codebase-index.json (may legitimately be absent on this machine)", async () => {
			const result = await loadGlobalDotfile()
			// We don't know if the real global dotfile exists; the guarantee is just that
			// the loader doesn't throw and always returns a well-formed result.
			expect(result.filePath).toBe(getGlobalDotfilePath())
			expect(typeof result.exists).toBe("boolean")
		})
	})

	describe("formatDotfileWarning", () => {
		it("formats secret-rejected warnings with the field list", () => {
			const msg = formatDotfileWarning("/x/.roo/codebase-index.json", {
				type: "secrets-rejected",
				fields: ["codeIndexQdrantApiKey"],
			})
			expect(msg).toContain("/x/.roo/codebase-index.json")
			expect(msg).toContain("codeIndexQdrantApiKey")
			expect(msg.toLowerCase()).toContain("never commit")
		})

		it("formats parse-error warnings", () => {
			const msg = formatDotfileWarning("/p", { type: "parse-error", message: "Unexpected token" })
			expect(msg).toContain("invalid JSON")
		})

		it("formats schema-error warnings", () => {
			const msg = formatDotfileWarning("/s", { type: "schema-error", message: "x: bad" })
			expect(msg).toContain("schema validation failed")
		})
	})
})

import * as path from "path"

import { CODEBASE_INDEX_SECRET_FIELDS, codebaseIndexDotfileSchema, type CodebaseIndexDotfile } from "@roo-code/types"

import { getGlobalRooDirectory, getProjectRooDirectoryForCwd, readFileIfExists } from "../roo-config"

export const CODEBASE_INDEX_DOTFILE_FILENAME = "codebase-index.json"

export type DotfileWarning =
	| { type: "secrets-rejected"; fields: string[] }
	| { type: "parse-error"; message: string }
	| { type: "schema-error"; message: string }

export interface DotfileLoadResult {
	data: CodebaseIndexDotfile | null
	warnings: DotfileWarning[]
	filePath: string
	/** True when the file exists on disk (regardless of whether parsing succeeded). */
	exists: boolean
}

export function getProjectDotfilePath(workspacePath: string): string {
	return path.join(getProjectRooDirectoryForCwd(workspacePath), CODEBASE_INDEX_DOTFILE_FILENAME)
}

export function getGlobalDotfilePath(): string {
	return path.join(getGlobalRooDirectory(), CODEBASE_INDEX_DOTFILE_FILENAME)
}

/**
 * Reads and validates a codebase-index dotfile.
 *
 * Secret-field keys (API keys) are NEVER accepted in the dotfile (which is safe-to-commit).
 * If any appear, they're stripped and reported as a `secrets-rejected` warning; the rest of
 * the file continues to validate.
 *
 * On JSON parse error or strict schema violation, returns `{ data: null, warnings: [...] }`
 * so the caller can surface a single actionable toast. Missing file returns
 * `{ data: null, exists: false, warnings: [] }` — the common, silent case.
 */
export async function loadCodebaseIndexDotfile(filePath: string): Promise<DotfileLoadResult> {
	const raw = await readFileIfExists(filePath)
	if (raw === null) {
		return { data: null, warnings: [], filePath, exists: false }
	}

	const warnings: DotfileWarning[] = []

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		warnings.push({
			type: "parse-error",
			message: error instanceof Error ? error.message : String(error),
		})
		return { data: null, warnings, filePath, exists: true }
	}

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		warnings.push({ type: "parse-error", message: "Expected a JSON object at the root" })
		return { data: null, warnings, filePath, exists: true }
	}

	// Strip any secret-field keys before strict validation and warn about them explicitly.
	const secretFieldsPresent: string[] = []
	const sanitized: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if ((CODEBASE_INDEX_SECRET_FIELDS as readonly string[]).includes(key)) {
			secretFieldsPresent.push(key)
			continue
		}
		sanitized[key] = value
	}
	if (secretFieldsPresent.length > 0) {
		warnings.push({ type: "secrets-rejected", fields: secretFieldsPresent })
	}

	const result = codebaseIndexDotfileSchema.safeParse(sanitized)
	if (!result.success) {
		warnings.push({
			type: "schema-error",
			message: result.error.issues
				.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
				.join("; "),
		})
		return { data: null, warnings, filePath, exists: true }
	}

	return { data: result.data, warnings, filePath, exists: true }
}

export async function loadProjectDotfile(workspacePath: string): Promise<DotfileLoadResult> {
	return loadCodebaseIndexDotfile(getProjectDotfilePath(workspacePath))
}

export async function loadGlobalDotfile(): Promise<DotfileLoadResult> {
	return loadCodebaseIndexDotfile(getGlobalDotfilePath())
}

/**
 * Formats a dotfile warning into a human-readable string suitable for a VS Code toast.
 */
export function formatDotfileWarning(filePath: string, warning: DotfileWarning): string {
	switch (warning.type) {
		case "secrets-rejected":
			return `${filePath}: removed secret field(s) from dotfile: ${warning.fields.join(", ")}. Store API keys in settings (workspace or global) — never commit them.`
		case "parse-error":
			return `${filePath}: invalid JSON — ${warning.message}`
		case "schema-error":
			return `${filePath}: schema validation failed — ${warning.message}`
	}
}

// npx vitest run api/providers/fetchers/__tests__/requesty.spec.ts

import axios from "axios"

import { getRequestyModels } from "../requesty"

vi.mock("axios")
const mockAxiosGet = vi.mocked(axios.get)

function makeRawModel(overrides: Record<string, unknown>) {
	return {
		id: "some/model",
		max_output_tokens: 8192,
		context_window: 200000,
		supports_caching: false,
		supports_vision: false,
		supports_reasoning: false,
		input_price: "0.000003",
		output_price: "0.000015",
		description: "Test model",
		caching_price: null,
		cached_price: null,
		...overrides,
	}
}

describe("getRequestyModels", () => {
	it("applies Fable 5 overrides when parsing anthropic/claude-fable-5", async () => {
		const rawFable5 = makeRawModel({
			id: "anthropic/claude-fable-5",
			max_output_tokens: 128000,
			context_window: 1000000,
			supports_caching: true,
			supports_vision: true,
			supports_reasoning: true,
			input_price: "0.00001",
			output_price: "0.00005",
			caching_price: "0.0000125",
			cached_price: "0.000001",
		})

		mockAxiosGet.mockResolvedValueOnce({ data: { data: [rawFable5] } })

		const models = await getRequestyModels()
		const fable5 = models["anthropic/claude-fable-5"]

		expect(fable5).toBeDefined()
		// Local fork: Fable uses the effort/adaptive shape (not budget/binary), so the fetcher
		// mirrors the static effort def and explicitly clears the generic claude budget default.
		expect(fable5.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"])
		expect(fable5.requiredReasoningEffort).toBe(true)
		expect(fable5.reasoningEffort).toBe("high")
		expect(fable5.supportsReasoningBudget).toBe(false)
		expect(fable5.supportsTemperature).toBe(false)
	})

	it("applies Sonnet 5 overrides when parsing anthropic/claude-sonnet-5", async () => {
		const rawSonnet5 = makeRawModel({
			id: "anthropic/claude-sonnet-5",
			max_output_tokens: 128000,
			context_window: 1000000,
			supports_caching: true,
			supports_vision: true,
			supports_reasoning: true,
			input_price: "0.000003",
			output_price: "0.000015",
			caching_price: "0.00000375",
			cached_price: "0.0000003",
		})

		mockAxiosGet.mockResolvedValueOnce({ data: { data: [rawSonnet5] } })

		const models = await getRequestyModels()
		const sonnet5 = models["anthropic/claude-sonnet-5"]

		expect(sonnet5).toBeDefined()
		// Fork shapes Sonnet 5 as effort/adaptive (mirrors the fable-5 override), not budget/binary.
		expect(sonnet5.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"])
		expect(sonnet5.requiredReasoningEffort).toBe(true)
		expect(sonnet5.supportsReasoningBudget).toBe(false)
		expect(sonnet5.supportsTemperature).toBe(false)
	})

	it("applies Opus 5 overrides when parsing anthropic/claude-opus-5", async () => {
		const rawOpus5 = makeRawModel({
			id: "anthropic/claude-opus-5",
			max_output_tokens: 128000,
			context_window: 1000000,
			supports_caching: true,
			supports_vision: true,
			supports_reasoning: true,
			input_price: "0.000005",
			output_price: "0.000025",
			caching_price: "0.00000625",
			cached_price: "0.0000005",
		})

		mockAxiosGet.mockResolvedValueOnce({ data: { data: [rawOpus5] } })

		const models = await getRequestyModels()
		const opus5 = models["anthropic/claude-opus-5"]

		expect(opus5).toBeDefined()
		// Fork shapes Opus 5 as effort/adaptive (mirrors the sonnet-5 override), not budget/binary.
		expect(opus5.supportsReasoningEffort).toEqual(["low", "medium", "high", "xhigh", "max"])
		expect(opus5.requiredReasoningEffort).toBe(true)
		expect(opus5.supportsReasoningBudget).toBe(false)
		expect(opus5.supportsTemperature).toBe(false)
	})

	it("does not apply Fable 5 overrides to other models", async () => {
		const rawSonnet = makeRawModel({
			id: "anthropic/claude-sonnet-4.6",
			supports_reasoning: true,
		})

		mockAxiosGet.mockResolvedValueOnce({ data: { data: [rawSonnet] } })

		const models = await getRequestyModels()
		const sonnet = models["anthropic/claude-sonnet-4.6"]

		expect(sonnet.supportsReasoningBinary).toBeUndefined()
		expect(sonnet.supportsTemperature).toBeUndefined()
	})
})

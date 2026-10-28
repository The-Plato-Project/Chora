import type { ModelDeltaHandler, ModelProvider, ModelRequest, ModelResponse } from "../../shared/models/ModelTypes.js";
import { CreateProviderError } from "./ModelProviderError.js";

const MockLatencyMilliseconds = 650;

// Creates deterministic model output without external inference.
function CreateChatResponse(request: ModelRequest): string
{
	let response = "";

	if (request.systemPrompt.includes("philosophical reading companion participating"))
	{
		response = "## Emerging Relationships\n\nThe current Signals and Reflections gather around a shared movement in the passage while leaving its tensions open.";
	}
	else
	{
		const trimmedText = request.userPrompt.trim();
		const normalizedText = trimmedText.replace(/\s+/gu, " ");
		const excerpt = normalizedText.slice(0, 240);
		response = `Working from this selected text-state: "${excerpt}". The first useful question is how the passage's movement, delay, or reversal bears on your question.`;
	}

	return response;
}

function IsFailureEnabled(): boolean
{
	const configuredValue = process.env.MOCK_MODEL_FAILURE ?? process.env.MOCK_ANALYSIS_FAILURE ?? "false";
	const normalizedValue = configuredValue.trim().toLowerCase();
	const isEnabled = normalizedValue === "true";

	return isEnabled;
}

function WaitForLatency(signal?: AbortSignal): Promise<void>
{
	const delay = new Promise<void>(function ResolveDelay(resolve, reject)
	{
		const timeout = setTimeout(function Complete(): void
		{
			signal?.removeEventListener("abort", Abort);
			resolve();
		}, MockLatencyMilliseconds);
		function Abort(): void
		{
			clearTimeout(timeout);
			reject(new DOMException("The model request was cancelled.", "AbortError"));
		}
		if (signal?.aborted === true) Abort();
		else signal?.addEventListener("abort", Abort, { once: true });
	});

	return delay;
}

export class MockModelProvider implements ModelProvider
{
	public readonly id = "mock" as const;

	public async CompleteAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		await WaitForLatency(signal);

		if (IsFailureEnabled())
		{
			const error = CreateProviderError("mock-failure", "Mock model failure is enabled by MOCK_MODEL_FAILURE.");

			throw error;
		}

		const rawText = CreateChatResponse(request);
		const result: ModelResponse = {
			provider: this.id,
			model: "deterministic-mock",
			rawText
		};

		if (onDelta !== undefined)
		{
			onDelta(rawText);
		}

		return result;
	}
}

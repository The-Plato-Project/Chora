import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaModelProvider } from "../../src/main/models/OllamaModelProvider.js";
import { ModelApi } from "../../src/main/models/ModelApi.js";
import type { ModelRequest } from "../../src/shared/models/ModelTypes.js";

// Creates one representative Chora request with prior conversation history.
function CreateRequest(): ModelRequest
{
	const request: ModelRequest = {
		systemPrompt: "Remain a companion to the reader.",
		history: [
			{ role: "user", content: "Earlier question" },
			{ role: "assistant", content: "Earlier response" }
		],
		userPrompt: "Current captured Dream context"
	};

	return request;
}

describe("Ollama provider", function OllamaProviderTests()
{
	afterEach(function RestoreEnvironment(): void
	{
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("discovers allowlisted models through the native tags endpoint", async function DiscoversModelsAsync(): Promise<void>
	{
		let requestUrl = "";
		vi.stubEnv("OLLAMA_BASE_URL", "http://192.168.68.64:11434/");
		vi.stubEnv("OLLAMA_MODELS", "qwen3.5:9b");
		vi.stubGlobal("fetch", async function ReturnTags(input: RequestInfo | URL): Promise<Response>
		{
			requestUrl = input.toString();
			const response = new Response(JSON.stringify({
				models: [
					{ name: "qwen3.5:9b", model: "qwen3.5:9b" },
					{ name: "gemma4:latest", model: "gemma4:latest" }
				]
			}), { status: 200 });

			return response;
		});

		const provider = new OllamaModelProvider();
		const models = await provider.ListModelsAsync();

		expect(requestUrl).toBe("http://192.168.68.64:11434/api/tags");
		expect(models).toEqual(["qwen3.5:9b"]);
	});

	it("sends native chat history and saves only final response content", async function CompletesChatAsync(): Promise<void>
	{
		let requestUrl = "";
		let requestInit: RequestInit | undefined;
		let receivedDelta = "";
		vi.stubEnv("OLLAMA_BASE_URL", "http://192.168.68.64:11434");
		vi.stubEnv("OLLAMA_CONTEXT_LENGTH", "65536");
		vi.stubGlobal("fetch", async function ReturnChat(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			requestUrl = input.toString();
			requestInit = init;
			const response = new Response(JSON.stringify({
				model: "qwen3.5:9b",
				message: {
					role: "assistant",
					content: "Final response"
				},
				thinking: "Separate reasoning that must not be saved",
				done: true,
				done_reason: "stop",
				prompt_eval_count: 41,
				eval_count: 17
			}), { status: 200 });

			return response;
		});

		const provider = new OllamaModelProvider("qwen3.5:9b");
		const result = await provider.CompleteAsync(CreateRequest(), function ReceiveDelta(delta): void
		{
			receivedDelta += delta;
		});
		const body = JSON.parse(requestInit?.body as string) as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			stream: boolean;
			think: boolean;
			options: { num_ctx: number };
		};

		expect(requestUrl).toBe("http://192.168.68.64:11434/api/chat");
		expect(body).toEqual({
			model: "qwen3.5:9b",
			messages: [
				{ role: "system", content: "Remain a companion to the reader." },
				{ role: "user", content: "Earlier question" },
				{ role: "assistant", content: "Earlier response" },
				{ role: "user", content: "Current captured Dream context" }
			],
			stream: false,
			think: false,
			options: {
				num_ctx: 65536
			}
		});
		expect(receivedDelta).toBe("Final response");
		expect(result).toEqual({
			provider: "ollama",
			model: "qwen3.5:9b",
			rawText: "Final response",
			usage: {
				inputTokens: 41,
				outputTokens: 17,
				totalTokens: 58
			}
		});
	});

	it("links reader cancellation to the active Ollama request", async function CancelsRequestAsync(): Promise<void>
	{
		let requestSignal: AbortSignal | null = null;
		vi.stubGlobal("fetch", function WaitForAbort(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			requestSignal = init?.signal ?? null;
			const response = new Promise<Response>(function RejectWhenAborted(_resolve, reject)
			{
				requestSignal?.addEventListener("abort", function RejectAbort(): void
				{
					reject(new DOMException("Cancelled", "AbortError"));
				}, { once: true });
			});

			return response;
		});
		const abort = new AbortController();
		const provider = new OllamaModelProvider("qwen3.5:9b");
		const completion = provider.CompleteAsync(CreateRequest(), undefined, abort.signal);
		abort.abort();

		await expect(completion).rejects.toMatchObject({ code: "timeout" });
		expect(requestSignal?.aborted).toBe(true);
	});

	it("aborts an Ollama request after the configured timeout", async function TimesOutRequestAsync(): Promise<void>
	{
		vi.useFakeTimers();
		vi.stubEnv("OLLAMA_REQUEST_TIMEOUT_MS", "25");
		vi.stubGlobal("fetch", function WaitForTimeout(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			const signal = init?.signal;
			const response = new Promise<Response>(function RejectWhenAborted(_resolve, reject)
			{
				signal?.addEventListener("abort", function RejectAbort(): void
				{
					reject(new DOMException("Timed out", "AbortError"));
				}, { once: true });
			});

			return response;
		});
		const provider = new OllamaModelProvider("qwen3.5:9b");
		const completion = provider.CompleteAsync(CreateRequest());
		const rejection = expect(completion).rejects.toMatchObject({ code: "timeout" });
		await vi.advanceTimersByTimeAsync(25);

		await rejection;
	});

	it("bounds remote model discovery with its own timeout", async function TimesOutDiscoveryAsync(): Promise<void>
	{
		vi.useFakeTimers();
		vi.stubEnv("OLLAMA_DISCOVERY_TIMEOUT_MS", "25");
		vi.stubGlobal("fetch", function WaitForTimeout(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			const signal = init?.signal;
			const response = new Promise<Response>(function RejectWhenAborted(_resolve, reject)
			{
				signal?.addEventListener("abort", function RejectAbort(): void
				{
					reject(new DOMException("Timed out", "AbortError"));
				}, { once: true });
			});

			return response;
		});
		const provider = new OllamaModelProvider();
		const discovery = provider.ListModelsAsync();
		const rejection = expect(discovery).rejects.toMatchObject({ code: "timeout" });
		await vi.advanceTimersByTimeAsync(25);

		await rejection;
	});

	it("rejects a nonterminal Ollama response", async function RejectsIncompleteResponseAsync(): Promise<void>
	{
		vi.stubGlobal("fetch", async function ReturnIncompleteResponse(): Promise<Response>
		{
			const response = new Response(JSON.stringify({
				model: "qwen3.5:9b",
				message: { role: "assistant", content: "Partial response" },
				done: false
			}), { status: 200 });

			return response;
		});
		const provider = new OllamaModelProvider("qwen3.5:9b");

		await expect(provider.CompleteAsync(CreateRequest())).rejects.toMatchObject({
			code: "malformed-response",
			message: "Ollama returned an incomplete model response."
		});
	});

	it("lists Ollama alongside another enabled provider", async function ListsMultipleProvidersAsync(): Promise<void>
	{
		vi.stubEnv("MODEL_PROVIDERS", "kimi,ollama");
		vi.stubEnv("KIMI_MODEL", "kimi-k2.6");
		vi.stubEnv("OLLAMA_MODELS", "qwen3.5:9b");
		vi.stubGlobal("fetch", async function ReturnTags(): Promise<Response>
		{
			const response = new Response(JSON.stringify({
				models: [{ name: "qwen3.5:9b", model: "qwen3.5:9b" }]
			}), { status: 200 });

			return response;
		});

		const api = new ModelApi();
		const models = await api.ListModelsAsync();

		expect(models).toEqual([
			{ provider: "kimi", model: "kimi-k2.6", label: "kimi-k2.6" },
			{ provider: "ollama", model: "qwen3.5:9b", label: "qwen3.5:9b · Ollama" }
		]);
	});

	it("does not rediscover a validated model before completion", async function AvoidsDuplicateDiscoveryAsync(): Promise<void>
	{
		let discoveryRequests = 0;
		let chatRequests = 0;
		vi.stubEnv("MODEL_PROVIDERS", "ollama");
		vi.stubEnv("OLLAMA_MODELS", "qwen3.5:9b");
		vi.stubGlobal("fetch", async function ReturnOllamaResponse(input: RequestInfo | URL): Promise<Response>
		{
			const url = input.toString();
			let response: Response;
			if (url.endsWith("/api/tags"))
			{
				discoveryRequests += 1;
				response = new Response(JSON.stringify({
					models: [{ name: "qwen3.5:9b", model: "qwen3.5:9b" }]
				}), { status: 200 });
			}
			else
			{
				chatRequests += 1;
				response = new Response(JSON.stringify({
					model: "qwen3.5:9b",
					message: { role: "assistant", content: "Final response" },
					done: true,
					done_reason: "stop"
				}), { status: 200 });
			}
			return response;
		});
		const api = new ModelApi();
		const resolved = await api.ResolveSelectionAsync({ provider: "ollama", model: "qwen3.5:9b" });

		await api.CompleteAsync(resolved, CreateRequest());

		expect(discoveryRequests).toBe(1);
		expect(chatRequests).toBe(1);
	});
});

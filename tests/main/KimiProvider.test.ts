import { afterEach, describe, expect, it, vi } from "vitest";
import { KimiModelProvider } from "../../src/main/models/KimiModelProvider.js";

describe("Kimi provider", function KimiProviderTests()
{
	afterEach(function RestoreEnvironment()
	{
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("sends a Chat Completions request and maps the response", async function SendsRequest()
	{
		let requestUrl = "";
		let requestInit: RequestInit | undefined;
		const responsePayload = {
			id: "request-123",
			choices: [{
				delta: {
					reasoning_content: "Internal reasoning",
					content: "Response"
				},
				finish_reason: "stop"
			}],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 20,
				total_tokens: 30
			}
		};
		const responseText = `data: ${JSON.stringify(responsePayload)}\n\ndata: [DONE]\n`;
		let streamedText = "";

		vi.stubEnv("MOONSHOT_API_KEY", "test-key");
		vi.stubEnv("MODEL_NAME", "kimi-k2.6");
		vi.stubEnv("KIMI_BASE_URL", "https://api.moonshot.ai/v1/");
		vi.stubGlobal("fetch", async function CaptureRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			requestUrl = input.toString();
			requestInit = init;
			const response = new Response(responseText, { status: 200 });

			return response;
		});

		const provider = new KimiModelProvider();
		const result = await provider.CompleteAsync({
			systemPrompt: "System prompt",
			userPrompt: "User prompt",
			history: []
		}, function ReceiveDelta(delta: string): void
		{
			streamedText += delta;
		});
		const requestBody = requestInit?.body;
		const bodyText = typeof requestBody === "string" ? requestBody : "";
		const body = JSON.parse(bodyText) as {
			model: string;
			messages: Array<{
				role: string;
				content: string;
			}>;
			stream: boolean;
			max_completion_tokens: number;
			thinking: {
				type: string;
			};
		};

		expect(requestUrl).toBe("https://api.moonshot.ai/v1/chat/completions");
		expect(body.model).toBe("kimi-k2.6");
		expect(body.messages).toEqual([
			{ role: "system", content: "System prompt" },
			{ role: "user", content: "User prompt" }
		]);
		expect(body.stream).toBe(true);
		expect(body.max_completion_tokens).toBe(3000);
		expect(body.thinking).toEqual({ type: "disabled" });
		expect(streamedText).toBe("Response");
		expect(result).toEqual({
			provider: "kimi",
			model: "kimi-k2.6",
			rawText: "Response",
			requestId: "request-123",
			usage: {
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30
			}
		});
	});

	it("reports a token-limit cutoff instead of returning a truncated answer", async function RejectsTruncationAsync(): Promise<void>
	{
		vi.stubEnv("MOONSHOT_API_KEY", "test-key");
		vi.stubEnv("MODEL_NAME", "kimi-k2.6");
		vi.stubGlobal("fetch", async function ReturnTruncatedReplyAsync(): Promise<Response>
		{
			const payload = { choices: [{ delta: { content: "Unfinished reply" }, finish_reason: "length" }] };
			const serialized = JSON.stringify(payload);
			const response = new Response(`data: ${serialized}\n\ndata: [DONE]\n`, { status: 200 });
			return response;
		});
		const provider = new KimiModelProvider();
		const request = { systemPrompt: "Reply directly.", userPrompt: "Discuss this.", history: [] };
		const completion = provider.CompleteAsync(request);
		await expect(completion).rejects.toMatchObject({ code: "malformed-response", message: expect.stringContaining("output token limit") });
		const retry = provider.CompleteAsync(request);
		await expect(retry).rejects.toMatchObject({ code: "malformed-response" });
	});

	it("preserves conversation history in the request", async function PreservesHistory()
	{
		let requestBody = "";

		vi.stubEnv("MOONSHOT_API_KEY", "test-key");
		vi.stubEnv("MODEL_NAME", "kimi-k2.6");
		vi.stubGlobal("fetch", async function CaptureRequest(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			const body = init?.body;
			const bodyText = typeof body === "string" ? body : "";
			requestBody = bodyText;
			const responsePayload = { choices: [{ delta: { content: "Follow-up" } }] };
			const responseText = `data: ${JSON.stringify(responsePayload)}\n\ndata: [DONE]\n`;
			const response = new Response(responseText, { status: 200 });

			return response;
		});

		const provider = new KimiModelProvider();
		await provider.CompleteAsync({
			systemPrompt: "System prompt",
			userPrompt: "Second question",
			history: [
				{ role: "user", content: "First question" },
				{ role: "assistant", content: "First answer" }
			]
		});
		const payload = JSON.parse(requestBody) as {
			messages: Array<{
				role: string;
				content: string;
			}>;
		};

		expect(payload.messages).toEqual([
			{ role: "system", content: "System prompt" },
			{ role: "user", content: "First question" },
			{ role: "assistant", content: "First answer" },
			{ role: "user", content: "Second question" }
		]);
	});

	it("blocks a second request while a Kimi stream is active", async function BlocksConcurrentRequest()
	{
		let releaseRequest: (() => void) | undefined;
		const requestGate = new Promise<void>(function WaitForRelease(resolve)
		{
			releaseRequest = resolve;
		});

		vi.stubEnv("MOONSHOT_API_KEY", "test-key");
		vi.stubEnv("MODEL_NAME", "kimi-k2.6");
		vi.stubGlobal("fetch", async function HoldRequest(): Promise<Response>
		{
			await requestGate;
			const responsePayload = { choices: [{ delta: { content: "Response" } }] };
			const responseText = `data: ${JSON.stringify(responsePayload)}\n\ndata: [DONE]\n`;
			const response = new Response(responseText, { status: 200 });

			return response;
		});

		const firstProvider = new KimiModelProvider();
		const secondProvider = new KimiModelProvider();
		const request = {
			systemPrompt: "System prompt",
			userPrompt: "User prompt",
			history: [],
			context: null
		};
		const firstRequest = firstProvider.CompleteAsync(request);

		await expect(secondProvider.CompleteAsync(request)).rejects.toMatchObject({
			code: "rate-limit",
			message: "A Kimi request is already in progress. Wait for it to finish before starting another chat request."
		});

		releaseRequest?.();
		await firstRequest;
	});

	it("includes Kimi rate-limit diagnostics in the provider error", async function IncludesRateLimitDiagnostics()
	{
		vi.stubEnv("MOONSHOT_API_KEY", "test-key");
		vi.stubEnv("MODEL_NAME", "kimi-k2.6");
		vi.stubGlobal("fetch", async function ReturnRateLimit(): Promise<Response>
		{
			const body = JSON.stringify({
				error: {
					message: "TPM limit exceeded for <ak-secret-value>"
				}
			});
			const response = new Response(body, {
				status: 429,
				headers: {
					"retry-after": "12",
					"x-request-id": "request-429"
				}
			});

			return response;
		});

		const provider = new KimiModelProvider();
		const completion = provider.CompleteAsync({
			systemPrompt: "System prompt",
			userPrompt: "User prompt",
			history: [],
			context: null
		});

		await expect(completion).rejects.toMatchObject({
			code: "rate-limit",
			message: "Kimi rate limited the model request. Please try again later. TPM limit exceeded for <redacted> Retry after 12 seconds. Request ID: request-429."
		});
	});
});

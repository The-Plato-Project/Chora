import type { ModelDeltaHandler, ModelProvider, ModelRequest, ModelResponse } from "../../shared/models/ModelTypes.js";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { CreateProviderError, CreateResponseError, TranslateProviderError } from "./ModelProviderError.js";
import { LinkModelRequestAbort } from "./ModelRequestAbort.js";
import { DefaultKimiBaseUrl, DefaultKimiMaxCompletionTokens, GetOptionalPositiveIntegerValue, GetOptionalValue, GetRequiredValue } from "./ModelProviderSettings.js";

interface KimiMessage
{
	role: "system" | "user" | "assistant";
	content: string;
}

interface KimiStreamOptions
{
	include_usage: true;
}

interface KimiThinking
{
	type: "disabled";
}

interface KimiRequestBody
{
	model: string;
	messages: KimiMessage[];
	stream: true;
	stream_options: KimiStreamOptions;
	max_completion_tokens: number;
	thinking: KimiThinking;
}

const StreamOptions: KimiStreamOptions = {
	include_usage: true
};

const DisabledThinking: KimiThinking = {
	type: "disabled"
};

const RequestTimeoutMilliseconds = 120000;

let isKimiRequestLocked = false;
let kimiRequestSequence = 0;

function AcquireKimiRequestLock(): void
{
	if (isKimiRequestLocked)
	{
		Errors.Warning("KimiProvider", "Duplicate request blocked.");
		throw CreateProviderError("rate-limit", "A Kimi request is already in progress. Wait for it to finish before starting another chat request.");
	}

	isKimiRequestLocked = true;
}

function ReleaseKimiRequestLock(): void
{
	isKimiRequestLocked = false;
}

interface KimiUsage
{
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
}

interface KimiPayload
{
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
	usage?: KimiUsage;
	id?: string;
}

interface KimiStreamPayload
{
	choices?: Array<{
		delta?: {
			content?: string;
			reasoning_content?: string;
		};
		finish_reason?: string | null;
	}>;
	usage?: KimiUsage;
	id?: string;
}

class KimiStreamReader
{
	private readonly onDelta: ModelDeltaHandler | undefined;
	private readonly decoder = new TextDecoder();
	private pendingText = "";
	private rawText = "";
	private requestId: string | undefined;
	private usage: KimiUsage | undefined;
	private finishReason: string | null = null;
	private reasoningLength = 0;

	public constructor(onDelta: ModelDeltaHandler | undefined)
	{
		this.onDelta = onDelta;
	}

	public async Read(response: Response): Promise<KimiPayload>
	{
		const body = response.body;

		if (body === null)
		{
			throw new Error("Kimi returned an empty response stream.");
		}

		const reader = body.getReader();
		let isComplete = false;

		while (!isComplete)
		{
			const readResult = await reader.read();
			const chunkText = this.decoder.decode(readResult.value, { stream: !readResult.done });
			this.pendingText += chunkText;
			this.ReadLines();
			isComplete = readResult.done;
		}

		const finalText = this.decoder.decode();
		this.pendingText += finalText;
		this.ReadLines();
		this.ReadLine(this.pendingText);
		this.pendingText = "";
		const payload = this.BuildPayload();

		return payload;
	}

	private ReadLines(): void
	{
		let lineEnd = this.pendingText.indexOf("\n");

		while (lineEnd >= 0)
		{
			const line = this.pendingText.slice(0, lineEnd);
			this.pendingText = this.pendingText.slice(lineEnd + 1);
			this.ReadLine(line);
			lineEnd = this.pendingText.indexOf("\n");
		}
	}

	private ReadLine(line: string): void
	{
		const trimmedLine = line.trim();
		const dataPrefix = "data:";
		const hasData = trimmedLine.startsWith(dataPrefix);

		if (hasData)
		{
			const data = trimmedLine.slice(dataPrefix.length).trim();
			const isComplete = data === "[DONE]";

			if (!isComplete)
			{
				const payload = JSON.parse(data) as KimiStreamPayload;
				this.AddPayload(payload);
			}
		}
	}

	private AddPayload(payload: KimiStreamPayload): void
	{
		if (payload.id !== undefined)
		{
			this.requestId = payload.id;
		}

		if (payload.usage !== undefined)
		{
			this.usage = payload.usage;
		}

		const choice = payload.choices?.[0];
		const finishReason = choice?.finish_reason;

		if (finishReason !== undefined)
		{
			this.finishReason = finishReason;
		}

		const reasoningText = choice?.delta?.reasoning_content ?? "";
		this.reasoningLength += reasoningText.length;
		const deltaText = choice?.delta?.content ?? "";
		const hasDelta = deltaText.length > 0;

		if (hasDelta)
		{
			this.rawText += deltaText;

			if (this.onDelta !== undefined)
			{
				this.onDelta(deltaText);
			}
		}
	}

	private BuildPayload(): KimiPayload
	{
		const payload: KimiPayload = {
			choices: [{
				message: {
					content: this.rawText
				}
			}]
		};

		if (this.requestId !== undefined)
		{
			payload.id = this.requestId;
		}

		if (this.usage !== undefined)
		{
			payload.usage = this.usage;
		}

		Errors.Info("KimiProvider", "Stream completed.", {
			finishReason: this.finishReason,
			answerLength: this.rawText.length,
			reasoningLength: this.reasoningLength,
			usage: this.usage
		});

		if (this.finishReason === "length")
		{
			const error = CreateProviderError("malformed-response", "Kimi reached its output token limit before completing the reply. The incomplete answer was not saved. Try a shorter request or start a new conversation.");
			throw error;
		}

		return payload;
	}
}

function BuildBody(request: ModelRequest, model: string, maxCompletionTokens: number): string
{
	const messages: KimiMessage[] = [{
		role: "system",
		content: request.systemPrompt
	}];
	for (const message of request.history)
	{
		const historyMessage: KimiMessage = {
			role: message.role,
			content: message.content
		};
		messages.push(historyMessage);
	}

	const userMessage: KimiMessage = {
		role: "user",
		content: request.userPrompt
	};

	messages.push(userMessage);

	const requestBody: KimiRequestBody = {
		model,
		messages,
		stream: true,
		stream_options: StreamOptions,
		max_completion_tokens: maxCompletionTokens,
		thinking: DisabledThinking
	};

	const body = JSON.stringify(requestBody);

	return body;
}

function BuildUrl(baseUrl: string): string
{
	const normalizedUrl = baseUrl.replace(/\/$/, "");
	const requestUrl = `${normalizedUrl}/chat/completions`;

	return requestUrl;
}

function ReadKimiErrorMessage(errorBody: string): string | null
{
	let message: string | null = null;

	try
	{
		const payload = JSON.parse(errorBody) as {
			error?: {
				message?: unknown;
			};
		};
		const errorMessage = payload.error?.message;

		if (typeof errorMessage === "string" && errorMessage.trim().length > 0)
		{
			message = errorMessage.trim();
		}
	}
	catch
	{
		message = null;
	}

	return message;
}

function RedactSensitiveKimiErrorData(value: string): string
{
	const redactedValue = value.replace(/<(?:ak|sk)-[^>]+>/gi, "<redacted>");

	return redactedValue;
}

async function CreateKimiResponseError(response: Response): Promise<ReturnType<typeof CreateResponseError>>
{
	const errorBody = await response.text();
	const redactedErrorBody = RedactSensitiveKimiErrorData(errorBody);
	const headers: Record<string, string> = {};
	response.headers.forEach(function AddHeader(value, key)
	{
		headers[key] = value;
	});
	const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
	const retryAfter = response.headers.get("retry-after");

	Errors.Error("KimiProvider", "API request failed.", {
		status: response.status,
		body: redactedErrorBody,
		headers
	});

	const error = CreateResponseError("Kimi", response.status);
	const providerMessage = ReadKimiErrorMessage(redactedErrorBody);
	const details: string[] = [];

	if (providerMessage !== null)
	{
		details.push(providerMessage);
	}

	if (retryAfter !== null)
	{
		details.push(`Retry after ${retryAfter} seconds.`);
	}

	if (requestId !== null)
	{
		details.push(`Request ID: ${requestId}.`);
	}

	if (details.length > 0)
	{
		error.message = `${error.message} ${details.join(" ")}`;
	}

	return error;
}

function BuildUsage(payload: KimiUsage): NonNullable<ModelResponse["usage"]>
{
	const usage: NonNullable<ModelResponse["usage"]> = {};

	if (payload.prompt_tokens !== undefined)
	{
		usage.inputTokens = payload.prompt_tokens;
	}

	if (payload.completion_tokens !== undefined)
	{
		usage.outputTokens = payload.completion_tokens;
	}

	if (payload.total_tokens !== undefined)
	{
		usage.totalTokens = payload.total_tokens;
	}

	return usage;
}

function BuildResult(payload: KimiPayload, model: string): ModelResponse
{
	const rawText = payload.choices?.[0]?.message?.content ?? "";
	const hasText = rawText.trim().length > 0;

	if (!hasText)
	{
		const error = CreateProviderError("malformed-response", "Kimi returned an empty model response.");

		throw error;
	}

	const result: ModelResponse = {
		provider: "kimi",
		model,
		rawText
	};

	if (payload.id !== undefined)
	{
		result.requestId = payload.id;
	}

	if (payload.usage !== undefined)
	{
		const usage = BuildUsage(payload.usage);
		result.usage = usage;
	}

	return result;
}

export class KimiModelProvider implements ModelProvider
{
	public readonly id = "kimi" as const;
	// Model identifier fixed when a reader starts the conversation.
	private readonly modelId: string;

	// Creates a provider that uses the selected model or the environment default.
	public constructor(modelId: string = "")
	{
		this.modelId = modelId;
	}

	public async CompleteAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		let result: ModelResponse;

		AcquireKimiRequestLock();

		try
		{
			try
			{
				result = await this.SendAsync(request, onDelta, signal);
			}
			catch (error)
			{
				const translatedError = TranslateProviderError("Kimi", error);

				throw translatedError;
			}
		}
		finally
		{
			ReleaseKimiRequestLock();
		}

		return result;
	}

	private async SendAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		const apiKey = GetRequiredValue(["KIMI_API_KEY", "MOONSHOT_API_KEY"], "KIMI_API_KEY");
		const configuredModel = GetRequiredValue(["KIMI_MODEL", "MODEL_NAME"], "KIMI_MODEL");
		const hasSelectedModel = this.modelId.trim().length > 0;
		const model = hasSelectedModel ? this.modelId : configuredModel;
		const maxCompletionTokens = GetOptionalPositiveIntegerValue("KIMI_MAX_COMPLETION_TOKENS", DefaultKimiMaxCompletionTokens);
		const baseUrl = GetOptionalValue("KIMI_BASE_URL", DefaultKimiBaseUrl);
		const requestUrl = BuildUrl(baseUrl);
		const requestBody = BuildBody(request, model, maxCompletionTokens);
		kimiRequestSequence += 1;
		const requestNumber = kimiRequestSequence;

		Errors.Info("KimiProvider", "Request started.", {
			requestNumber,
			time: new Date().toISOString(),
			model,
			messageCount: request.history.length + 2,
			maxCompletionTokens,
			thinking: DisabledThinking.type
		});
		const controller = new AbortController();
		const unlinkAbort = LinkModelRequestAbort(controller, signal);
		const timeout = setTimeout(function AbortRequest()
		{
			controller.abort();
		}, RequestTimeoutMilliseconds);
		let result: ModelResponse;

		try
		{
			const response = await fetch(requestUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`
				},
				body: requestBody,
				signal: controller.signal
			});

			Errors.Debug("KimiProvider", "Response received.", {
				requestNumber,
				status: response.status
			});

			if (!response.ok)
			{
				const error = await CreateKimiResponseError(response);

				throw error;
			}

			const streamReader = new KimiStreamReader(onDelta);
			const payload = await streamReader.Read(response);
			result = BuildResult(payload, model);
		}
		finally
		{
			clearTimeout(timeout);
			unlinkAbort();
		}

		return result;
	}

}

import type { ModelDeltaHandler, ModelProvider, ModelRequest, ModelResponse } from "../../shared/models/ModelTypes.js";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { CreateProviderError, CreateResponseError, TranslateProviderError } from "./ModelProviderError.js";
import { LinkModelRequestAbort } from "./ModelRequestAbort.js";
import { DefaultOllamaBaseUrl, DefaultOllamaContextLength, DefaultOllamaDiscoveryTimeoutMilliseconds, DefaultOllamaRequestTimeoutMilliseconds, GetOptionalPositiveIntegerValue, GetOptionalValue } from "./ModelProviderSettings.js";

// One role-tagged message accepted by Ollama's native chat endpoint.
interface OllamaMessage
{
	readonly role: "system" | "user" | "assistant";
	readonly content: string;
}

// Native Ollama chat options controlled by Chora configuration.
interface OllamaOptions
{
	readonly num_ctx: number;
}

// Request payload sent to Ollama without enabling reasoning persistence.
interface OllamaChatRequest
{
	readonly model: string;
	readonly messages: readonly OllamaMessage[];
	readonly stream: false;
	readonly think: false;
	readonly options: OllamaOptions;
}

// Native model catalogue entry returned by Ollama.
interface OllamaModelEntry
{
	readonly name?: unknown;
	readonly model?: unknown;
}

// Native model catalogue response returned by Ollama.
interface OllamaModelCatalogue
{
	readonly models?: unknown;
	readonly error?: unknown;
}

// Native completed chat response; thinking is deliberately not represented.
interface OllamaChatResponse
{
	readonly model?: unknown;
	readonly message?: {
		readonly content?: unknown;
	};
	readonly done?: unknown;
	readonly done_reason?: unknown;
	readonly prompt_eval_count?: unknown;
	readonly eval_count?: unknown;
	readonly error?: unknown;
}

// Main-process Ollama adapter using only the native tags and chat APIs.
export class OllamaModelProvider implements ModelProvider
{
	public readonly id = "ollama" as const;
	// Model identity selected from the validated main-process catalogue.
	private readonly modelId: string;

	// Creates an adapter for one selected Ollama model.
	public constructor(modelId: string = "")
	{
		this.modelId = modelId;
	}

	// Lists installed models, optionally restricted by OLLAMA_MODELS.
	public async ListModelsAsync(signal?: AbortSignal): Promise<readonly string[]>
	{
		const url = this.BuildUrl("/api/tags");
		const timeoutMilliseconds = GetOptionalPositiveIntegerValue("OLLAMA_DISCOVERY_TIMEOUT_MS", DefaultOllamaDiscoveryTimeoutMilliseconds);
		const controller = new AbortController();
		const unlinkAbort = LinkModelRequestAbort(controller, signal);
		const timeout = setTimeout(function AbortDiscovery(): void
		{
			controller.abort();
		}, timeoutMilliseconds);
		let models: readonly string[];

		try
		{
			const response = await fetch(url, {
				method: "GET",
				headers: this.CreateHeaders(),
				signal: controller.signal
			});
			const payload = await this.ReadJsonAsync<OllamaModelCatalogue>(response);
			if (!response.ok)
			{
				throw this.CreateResponseError(response.status, payload.error);
			}
			if (!Array.isArray(payload.models))
			{
				throw CreateProviderError("malformed-response", "Ollama returned an invalid model catalogue.");
			}
			const discovered: string[] = [];
			for (const value of payload.models)
			{
				const entry = value as OllamaModelEntry;
				const model = typeof entry.model === "string" ? entry.model : typeof entry.name === "string" ? entry.name : "";
				const normalized = model.trim();
				if (normalized.length > 0 && normalized.length <= 128 && !discovered.includes(normalized))
				{
					discovered.push(normalized);
				}
			}
			const allowlist = this.ReadModelAllowlist();
			models = allowlist.length === 0
				? discovered
				: discovered.filter(function IsAllowed(model): boolean
				{
					return allowlist.includes(model);
				});
			if (models.length === 0)
			{
				throw CreateProviderError("configuration", "Ollama has no installed model matching OLLAMA_MODELS. Pull the configured model or update the allowlist.");
			}
		}
		catch (error)
		{
			const translated = TranslateProviderError("Ollama", error);
			throw translated;
		}
		finally
		{
			clearTimeout(timeout);
			unlinkAbort();
		}

		return models;
	}

	// Completes one Chora model request and exposes only final assistant content.
	public async CompleteAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		let result: ModelResponse;

		try
		{
			result = await this.SendAsync(request, signal);
		}
		catch (error)
		{
			const translated = TranslateProviderError("Ollama", error);
			throw translated;
		}

		if (onDelta !== undefined)
		{
			onDelta(result.rawText);
		}

		return result;
	}

	// Sends one non-streaming request so reasoning output cannot enter the transcript.
	private async SendAsync(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>
	{
		const model = this.modelId.trim();
		if (model.length === 0)
		{
			throw CreateProviderError("configuration", "Choose an available Ollama model before sending a message.");
		}
		const contextLength = GetOptionalPositiveIntegerValue("OLLAMA_CONTEXT_LENGTH", DefaultOllamaContextLength);
		const timeoutMilliseconds = GetOptionalPositiveIntegerValue("OLLAMA_REQUEST_TIMEOUT_MS", DefaultOllamaRequestTimeoutMilliseconds);
		const messages: OllamaMessage[] = [{
			role: "system",
			content: request.systemPrompt
		}];
		for (const historyMessage of request.history)
		{
			messages.push({
				role: historyMessage.role,
				content: historyMessage.content
			});
		}
		messages.push({
			role: "user",
			content: request.userPrompt
		});
		const body: OllamaChatRequest = {
			model,
			messages,
			stream: false,
			think: false,
			options: {
				num_ctx: contextLength
			}
		};
		const controller = new AbortController();
		const unlinkAbort = LinkModelRequestAbort(controller, signal);
		const timeout = setTimeout(function AbortRequest(): void
		{
			controller.abort();
		}, timeoutMilliseconds);
		let result: ModelResponse;

		try
		{
			const response = await fetch(this.BuildUrl("/api/chat"), {
				method: "POST",
				headers: this.CreateHeaders(),
				body: JSON.stringify(body),
				signal: controller.signal
			});
			const payload = await this.ReadJsonAsync<OllamaChatResponse>(response);
			if (!response.ok)
			{
				throw this.CreateResponseError(response.status, payload.error);
			}
			if (payload.done !== true)
			{
				throw CreateProviderError("malformed-response", "Ollama returned an incomplete model response.");
			}
			if (payload.done_reason === "length")
			{
				throw CreateProviderError("malformed-response", "Ollama reached its output limit before completing the reply. The incomplete answer was not saved.");
			}
			const rawText = typeof payload.message?.content === "string" ? payload.message.content : "";
			if (rawText.trim().length === 0)
			{
				throw CreateProviderError("malformed-response", "Ollama returned an empty model response.");
			}
			const responseModel = typeof payload.model === "string" && payload.model.trim().length > 0 ? payload.model.trim() : model;
			if (responseModel.length > 128)
			{
				throw CreateProviderError("malformed-response", "Ollama returned an invalid model identifier.");
			}
			result = {
				provider: this.id,
				model: responseModel,
				rawText
			};
			const usage = this.CreateUsage(payload);
			if (usage !== null)
			{
				result.usage = usage;
			}
		}
		finally
		{
			clearTimeout(timeout);
			unlinkAbort();
		}

		return result;
	}

	// Resolves a configured HTTP endpoint without exposing it outside main.
	private BuildUrl(path: string): string
	{
		const configuredBaseUrl = GetOptionalValue("OLLAMA_BASE_URL", DefaultOllamaBaseUrl);
		let baseUrl: URL;

		try
		{
			baseUrl = new URL(configuredBaseUrl);
		}
		catch
		{
			throw CreateProviderError("configuration", "OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL.");
		}
		if ((baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") || baseUrl.username.length > 0 || baseUrl.password.length > 0)
		{
			throw CreateProviderError("configuration", "OLLAMA_BASE_URL must be an HTTP or HTTPS URL without embedded credentials.");
		}
		const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/u, "");
		const url = `${normalizedBaseUrl}${path}`;

		return url;
	}

	// Creates server headers with optional reverse-proxy bearer authentication.
	private CreateHeaders(): Record<string, string>
	{
		const apiKey = GetOptionalValue("OLLAMA_API_KEY", "");
		const headers: Record<string, string> = {
			"Content-Type": "application/json"
		};
		if (apiKey.length > 0)
		{
			headers.Authorization = `Bearer ${apiKey}`;
		}

		return headers;
	}

	// Reads the optional exact model allowlist used for catalogue filtering.
	private ReadModelAllowlist(): readonly string[]
	{
		const configured = GetOptionalValue("OLLAMA_MODELS", "");
		const models: string[] = [];
		for (const value of configured.split(","))
		{
			const model = value.trim();
			if (model.length > 0 && !models.includes(model))
			{
				models.push(model);
			}
		}

		return models;
	}

	// Parses one bounded JSON response without retaining model reasoning.
	private async ReadJsonAsync<T>(response: Response): Promise<T>
	{
		const responseText = await response.text();
		let payload: T;

		try
		{
			payload = JSON.parse(responseText) as T;
		}
		catch
		{
			throw CreateProviderError("malformed-response", "Ollama returned an invalid JSON response.");
		}

		return payload;
	}

	// Preserves provider error details without logging prompts or responses.
	private CreateResponseError(status: number, value: unknown)
	{
		const error = CreateResponseError("Ollama", status);
		const providerMessage = typeof value === "string" ? value.trim() : "";
		if (providerMessage.length > 0)
		{
			error.message = `${error.message} ${providerMessage}`;
		}
		Errors.Warning("OllamaProvider", "API request failed.", {
			status,
			message: providerMessage
		});

		return error;
	}

	// Maps native Ollama evaluation counts into Chora's provider-neutral usage record.
	private CreateUsage(payload: OllamaChatResponse): NonNullable<ModelResponse["usage"]> | null
	{
		const inputTokens = typeof payload.prompt_eval_count === "number" ? payload.prompt_eval_count : undefined;
		const outputTokens = typeof payload.eval_count === "number" ? payload.eval_count : undefined;
		let usage: NonNullable<ModelResponse["usage"]> | null = null;

		if (inputTokens !== undefined || outputTokens !== undefined)
		{
			usage = {};
			if (inputTokens !== undefined)
			{
				usage.inputTokens = inputTokens;
			}
			if (outputTokens !== undefined)
			{
				usage.outputTokens = outputTokens;
			}
			if (inputTokens !== undefined && outputTokens !== undefined)
			{
				usage.totalTokens = inputTokens + outputTokens;
			}
		}

		return usage;
	}
}

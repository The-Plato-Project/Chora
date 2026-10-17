import type { ModelDeltaHandler, ModelProvider, ModelRequest, ModelResponse } from "../../shared/models/ModelTypes.js";
import { CreateProviderError, CreateResponseError, TranslateProviderError } from "./ModelProviderError.js";
import { DefaultCopilotRelayPort, GetOptionalPositiveIntegerValue, GetOptionalValue, GetRequiredValue } from "./ModelProviderSettings.js";
import { LinkModelRequestAbort } from "./ModelRequestAbort.js";

// Maximum duration for one request to the locally hosted VS Code Relay.
const RequestTimeoutMilliseconds = 120000;
// Header used to authenticate access to the local Relay extension.
const RelaySecretHeader = "x-copilot-relay-secret";

// JSON payload accepted by the local Copilot Relay extension.
interface CopilotRelayRequestBody
{
	prompt: string;
	modelFamily: string;
}

// JSON payload returned by the local Copilot Relay extension.
interface CopilotRelayResponseBody
{
	text?: string;
	modelFamily?: string;
	error?: string;
}

// JSON payload returned by the Relay model catalogue endpoint.
interface CopilotRelayModelCatalogueResponseBody
{
	modelFamilies?: string[];
	error?: string;
}

// Process-wide Relay request state because all instances use one VS Code session.
let isCopilotRelayRequestLocked = false;

// Acquires exclusive access to the local VS Code Relay session.
function AcquireCopilotRelayRequestLock(): void
{
	if (isCopilotRelayRequestLocked)
	{
		const error = CreateProviderError("rate-limit", "A VS Code Relay request is already in progress. Wait for it to finish before starting another chat request.");

		throw error;
	}

	isCopilotRelayRequestLocked = true;
}

// Releases exclusive access to the local VS Code Relay session.
function ReleaseCopilotRelayRequestLock(): void
{
	isCopilotRelayRequestLocked = false;
}

// Builds one explicit user prompt because the Relay invokes VS Code with one user message.
function BuildRelayPrompt(request: ModelRequest): string
{
	const historyLines: string[] = [];

	for (const message of request.history)
	{
		const historyLine = `${message.role.toUpperCase()}: ${message.content}`;

		historyLines.push(historyLine);
	}

	const blocks = [`[Instructions]\n${request.systemPrompt}`];
	const history = historyLines.length > 0 ? historyLines.join("\n\n") : "No earlier conversation.";
	blocks.push(`[Conversation]\n${history}`);
	blocks.push(`[Current Question]\n${request.userPrompt}`);
	const prompt = blocks.join("\n\n");

	return prompt;
}

// Resolves the Relay URL from a validated local-only port setting.
function BuildRelayUrl(port: number, path: string): string
{
	const url = `http://127.0.0.1:${port}${path}`;

	return url;
}

// Invokes GitHub Copilot through the local authenticated VS Code Relay extension.
export class CopilotRelayModelProvider implements ModelProvider
{
	public readonly id = "copilot-relay" as const;
	// Model family fixed when the reader starts the conversation.
	private readonly modelFamily: string;

	// Creates a provider that uses the selected family or the local Relay default.
	public constructor(modelFamily: string = "")
	{
		this.modelFamily = modelFamily;
	}

	// Lists authenticated Copilot model families available through the local Relay.
	public async ListModelFamiliesAsync(): Promise<string[]>
	{
		const sharedSecret = GetRequiredValue(["COPILOT_RELAY_SHARED_SECRET"], "COPILOT_RELAY_SHARED_SECRET");
		const port = GetOptionalPositiveIntegerValue("COPILOT_RELAY_PORT", DefaultCopilotRelayPort);
		const url = BuildRelayUrl(port, "/models");
		const response = await fetch(url, {
			method: "GET",
			headers: {
				[RelaySecretHeader]: sharedSecret
			}
		});
		const responseText = await response.text();
		const responseBody = this.ParseModelCatalogueResponse(responseText);

		if (!response.ok)
		{
			const error = this.CreateResponseError(response.status, responseBody.error);

			throw error;
		}

		const modelFamilies = responseBody.modelFamilies ?? [];

		return modelFamilies;
	}

	public async CompleteAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		AcquireCopilotRelayRequestLock();
		let result: ModelResponse;

		try
		{
			result = await this.SendAsync(request, onDelta, signal);
		}
		catch (error)
		{
			const translatedError = TranslateProviderError("VS Code Relay", error);

			throw translatedError;
		}
		finally
		{
			ReleaseCopilotRelayRequestLock();
		}

		return result;
	}

	// Performs one authenticated request against the fixed loopback Relay endpoint.
	private async SendAsync(request: ModelRequest, onDelta?: ModelDeltaHandler, signal?: AbortSignal): Promise<ModelResponse>
	{
		const sharedSecret = GetRequiredValue(["COPILOT_RELAY_SHARED_SECRET"], "COPILOT_RELAY_SHARED_SECRET");
		const configuredModelFamily = GetOptionalValue("COPILOT_RELAY_MODEL_FAMILY", "");
		const hasSelectedModelFamily = this.modelFamily.trim().length > 0;
		const modelFamily = hasSelectedModelFamily ? this.modelFamily : configuredModelFamily;
		const port = GetOptionalPositiveIntegerValue("COPILOT_RELAY_PORT", DefaultCopilotRelayPort);
		const url = BuildRelayUrl(port, "/prompt");
		const prompt = BuildRelayPrompt(request);
		const body: CopilotRelayRequestBody = {
			prompt,
			modelFamily
		};
		const serializedBody = JSON.stringify(body);
		const controller = new AbortController();
		const unlinkAbort = LinkModelRequestAbort(controller, signal);
		const timeout = setTimeout(function AbortRelayRequest(): void
		{
			controller.abort();
		}, RequestTimeoutMilliseconds);

		try
		{
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					[RelaySecretHeader]: sharedSecret
				},
				body: serializedBody,
				signal: controller.signal
			});
			const responseText = await response.text();
			const responseBody = this.ParseResponse(responseText);

			if (!response.ok)
			{
				const error = this.CreateResponseError(response.status, responseBody.error);

				throw error;
			}

			const text = responseBody.text ?? "";
			const hasText = text.trim().length > 0;

			if (!hasText)
			{
				const error = CreateProviderError("malformed-response", "VS Code Relay returned an empty model response.");

				throw error;
			}

			if (onDelta !== undefined)
			{
				onDelta(text);
			}

			const result: ModelResponse = {
				provider: this.id,
				model: responseBody.modelFamily ?? modelFamily,
				rawText: text
			};

			return result;
		}
		finally
		{
			clearTimeout(timeout);
			unlinkAbort();
		}
	}

	// Parses the JSON response returned by the local Relay endpoint.
	private ParseResponse(responseText: string): CopilotRelayResponseBody
	{
		let response: CopilotRelayResponseBody;

		try
		{
			response = JSON.parse(responseText) as CopilotRelayResponseBody;
		}
		catch
		{
			response = {};
		}

		return response;
	}

	// Parses the JSON model catalogue returned by the local Relay endpoint.
	private ParseModelCatalogueResponse(responseText: string): CopilotRelayModelCatalogueResponseBody
	{
		let response: CopilotRelayModelCatalogueResponseBody;

		try
		{
			response = JSON.parse(responseText) as CopilotRelayModelCatalogueResponseBody;
		}
		catch
		{
			response = {};
		}

		return response;
	}

	// Converts local Relay response status into a reader-facing provider error.
	private CreateResponseError(status: number, relayMessage: string | undefined)
	{
		let error;

		if (status === 401 || status === 403)
		{
			error = CreateProviderError("authentication", "VS Code Relay rejected COPILOT_RELAY_SHARED_SECRET. Configure it to match choraCopilotRelay.sharedSecret.");
		}
		else
		{
			error = CreateResponseError("VS Code Relay", status);
		}

		if (relayMessage !== undefined && relayMessage.trim().length > 0)
		{
			error.message = `${error.message} ${relayMessage}`;
		}

		return error;
	}
}
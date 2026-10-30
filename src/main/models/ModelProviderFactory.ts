import type { ModelSelection } from "../../shared/models/ModelSelection.js";
import type { ModelProvider, ProviderId } from "../../shared/models/ModelTypes.js";
import { CopilotRelayModelProvider } from "./CopilotRelayModelProvider.js";
import { KimiModelProvider } from "./KimiModelProvider.js";
import { MockModelProvider } from "./MockModelProvider.js";
import { OllamaModelProvider } from "./OllamaModelProvider.js";
import { CreateProviderError } from "./ModelProviderError.js";

// Returns the legacy single configured provider, defaulting to local mock behavior.
export function GetConfiguredProvider(): ProviderId
{
	const configuredProvider = (process.env.MODEL_PROVIDER ?? process.env.ANALYSIS_PROVIDER)?.trim();
	let providerId: ProviderId = "mock";

	if (configuredProvider === "kimi")
	{
		providerId = "kimi";
	}
	else if (configuredProvider === "copilot-relay")
	{
		providerId = "copilot-relay";
	}
	else if (configuredProvider === "ollama")
	{
		providerId = "ollama";
	}

	return providerId;
}

// Returns every explicitly enabled provider while preserving MODEL_PROVIDER fallback behavior.
export function GetConfiguredProviders(): readonly ProviderId[]
{
	const configuredProviders = process.env.MODEL_PROVIDERS?.trim() ?? "";
	const providers: ProviderId[] = [];

	if (configuredProviders.length === 0)
	{
		providers.push(GetConfiguredProvider());
	}
	else
	{
		const values = configuredProviders.split(",");
		for (const value of values)
		{
			const candidate = value.trim();
			if (!IsProviderId(candidate))
			{
				throw CreateProviderError("configuration", `MODEL_PROVIDERS contains an unsupported provider: ${candidate || "(empty)"}.`);
			}
			if (!providers.includes(candidate))
			{
				providers.push(candidate);
			}
		}
	}

	return providers;
}

// Creates the chosen adapter; public model choices are validated by ModelApi.
export function CreateModelProvider(selection?: ModelSelection): ModelProvider
{
	const configuredProvider = selection?.provider ?? GetConfiguredProvider();
	let provider: ModelProvider;

	if (configuredProvider === "kimi")
	{
		provider = new KimiModelProvider(selection?.model ?? "");
	}
	else if (configuredProvider === "copilot-relay")
	{
		provider = new CopilotRelayModelProvider(selection?.model ?? "");
	}
	else if (configuredProvider === "ollama")
	{
		provider = new OllamaModelProvider(selection?.model ?? "");
	}
	else
	{
		provider = new MockModelProvider();
	}

	return provider;
}

// Narrows environment text to one supported provider identity.
function IsProviderId(value: string): value is ProviderId
{
	const isProvider = value === "mock" || value === "kimi" || value === "copilot-relay" || value === "ollama";

	return isProvider;
}

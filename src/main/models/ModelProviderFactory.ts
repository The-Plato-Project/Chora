import type { ModelProvider, ProviderId } from "../../shared/models/ModelTypes.js";
import { CopilotRelayModelProvider } from "./CopilotRelayModelProvider.js";
import { KimiModelProvider } from "./KimiModelProvider.js";
import { MockModelProvider } from "./MockModelProvider.js";

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

	return providerId;
}

export function CreateModelProvider(): ModelProvider
{
	const configuredProvider = GetConfiguredProvider();
	let provider: ModelProvider;

	if (configuredProvider === "kimi")
	{
		provider = new KimiModelProvider();
	}
	else if (configuredProvider === "copilot-relay")
	{
		provider = new CopilotRelayModelProvider();
	}
	else
	{
		provider = new MockModelProvider();
	}

	return provider;
}

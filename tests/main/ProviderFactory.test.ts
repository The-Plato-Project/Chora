import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../src/shared/models/ModelTypes.js";
import { CopilotRelayModelProvider } from "../../src/main/models/CopilotRelayModelProvider.js";
import { KimiModelProvider } from "../../src/main/models/KimiModelProvider.js";
import { MockModelProvider } from "../../src/main/models/MockModelProvider.js";
import { OllamaModelProvider } from "../../src/main/models/OllamaModelProvider.js";
import { CreateModelProvider, GetConfiguredProviders } from "../../src/main/models/ModelProviderFactory.js";

function CreateRequest(): ModelRequest
{
	const request: ModelRequest = {
		systemPrompt: "System prompt",
		userPrompt: "Question",
		history: []
	};

	return request;
}

describe("Model provider factory", function ProviderFactoryTests()
{
	afterEach(function RestoreEnvironment()
	{
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("uses mock when no configured provider is present", function UsesMockDefault()
	{
		const provider = CreateModelProvider();

		expect(provider).toBeInstanceOf(MockModelProvider);
	});

	it("creates the Kimi provider from main-process configuration", function CreatesConfiguredProvider()
	{
		vi.stubEnv("MODEL_PROVIDER", "kimi");
		const kimiProvider = CreateModelProvider();

		expect(kimiProvider).toBeInstanceOf(KimiModelProvider);
	});

	it("creates the Copilot Relay provider from main-process configuration", function CreatesRelayProvider()
	{
		vi.stubEnv("MODEL_PROVIDER", "copilot-relay");
		const relayProvider = CreateModelProvider();

		expect(relayProvider).toBeInstanceOf(CopilotRelayModelProvider);
	});

	it("creates the Ollama provider from main-process configuration", function CreatesOllamaProvider()
	{
		vi.stubEnv("MODEL_PROVIDER", "ollama");
		const ollamaProvider = CreateModelProvider();

		expect(ollamaProvider).toBeInstanceOf(OllamaModelProvider);
	});

	it("preserves the explicit enabled-provider order", function ListsConfiguredProviders()
	{
		vi.stubEnv("MODEL_PROVIDERS", "copilot-relay,ollama,kimi,ollama");
		const providers = GetConfiguredProviders();

		expect(providers).toEqual(["copilot-relay", "ollama", "kimi"]);
	});

	it("returns a controlled configuration error before a live request", async function ControlsMissingKeys()
	{
		const kimiProvider = new KimiModelProvider();

		await expect(kimiProvider.CompleteAsync(CreateRequest())).rejects.toMatchObject({
			code: "configuration"
		});
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../src/shared/models/ModelTypes.js";
import { CopilotRelayModelProvider } from "../../src/main/models/CopilotRelayModelProvider.js";
import { KimiModelProvider } from "../../src/main/models/KimiModelProvider.js";
import { MockModelProvider } from "../../src/main/models/MockModelProvider.js";
import { CreateModelProvider } from "../../src/main/models/ModelProviderFactory.js";

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

	it("returns a controlled configuration error before a live request", async function ControlsMissingKeys()
	{
		const kimiProvider = new KimiModelProvider();

		await expect(kimiProvider.CompleteAsync(CreateRequest())).rejects.toMatchObject({
			code: "configuration"
		});
	});
});

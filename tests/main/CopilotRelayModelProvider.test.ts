import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotRelayModelProvider } from "../../src/main/models/CopilotRelayModelProvider.js";
import type { ModelRequest } from "../../src/shared/models/ModelTypes.js";

// Creates a representative request with context and history for Relay prompt serialization.
function CreateRequest(): ModelRequest
{
	const request: ModelRequest = {
		systemPrompt: "Attend to the text.",
		userPrompt: "What is at stake?",
		history: [
			{ role: "user", content: "Where should I begin?" },
			{ role: "assistant", content: "Begin with the image." }
		],
		context: { mode: "FREE" }
	};

	return request;
}

describe("Copilot Relay provider", function CopilotRelayProviderTests()
{
	afterEach(function RestoreEnvironment(): void
	{
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("sends an authenticated local Relay request and forwards the completed response", async function SendsRelayRequest(): Promise<void>
	{
		let requestUrl = "";
		let requestInit: RequestInit | undefined;
		let receivedDelta = "";
		vi.stubEnv("COPILOT_RELAY_SHARED_SECRET", "shared-secret");
		vi.stubEnv("COPILOT_RELAY_MODEL_FAMILY", "gpt-4.1");
		vi.stubGlobal("fetch", async function CaptureRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			requestUrl = input.toString();
			requestInit = init;
			const response = new Response(JSON.stringify({ text: "A careful response.", modelFamily: "gpt-4.1" }), { status: 200 });

			return response;
		});

		const provider = new CopilotRelayModelProvider();
		const result = await provider.CompleteAsync(CreateRequest(), function ReceiveDelta(delta: string): void
		{
			receivedDelta += delta;
		});
		const headers = requestInit?.headers as Record<string, string>;
		const bodyText = requestInit?.body as string;
		const body = JSON.parse(bodyText) as { prompt: string; modelFamily: string };

		expect(requestUrl).toBe("http://127.0.0.1:4319/prompt");
		expect(headers["x-copilot-relay-secret"]).toBe("shared-secret");
		expect(body.modelFamily).toBe("gpt-4.1");
		expect(body.prompt).toContain("[Instructions]\nAttend to the text.");
		expect(body.prompt).toContain("USER: Where should I begin?");
		expect(receivedDelta).toBe("A careful response.");
		expect(result).toEqual({ provider: "copilot-relay", model: "gpt-4.1", rawText: "A careful response." });
	});

	it("reports a bad shared secret as an authentication error", async function ReportsAuthenticationFailure(): Promise<void>
	{
		vi.stubEnv("COPILOT_RELAY_SHARED_SECRET", "incorrect-secret");
		vi.stubGlobal("fetch", async function RejectRequest(): Promise<Response>
		{
			const response = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

			return response;
		});

		const provider = new CopilotRelayModelProvider();
		const completion = provider.CompleteAsync(CreateRequest());

		await expect(completion).rejects.toMatchObject({
			code: "authentication",
			message: "VS Code Relay rejected COPILOT_RELAY_SHARED_SECRET. Configure it to match choraCopilotRelay.sharedSecret. Unauthorized"
		});
	});

	it("lets the Relay select an available model when no family is configured", async function UsesRelayDefaultModelAsync(): Promise<void>
	{
		let requestInit: RequestInit | undefined;
		vi.stubEnv("COPILOT_RELAY_SHARED_SECRET", "shared-secret");
		vi.stubEnv("COPILOT_RELAY_MODEL_FAMILY", "");
		vi.stubGlobal("fetch", async function CaptureRequest(_input: RequestInfo | URL, init?: RequestInit): Promise<Response>
		{
			requestInit = init;
			return new Response(JSON.stringify({ text: "A careful response.", modelFamily: "gpt-5.6-sol" }), { status: 200 });
		});

		const provider = new CopilotRelayModelProvider();
		const result = await provider.CompleteAsync(CreateRequest());
		const body = JSON.parse(requestInit?.body as string) as { modelFamily: string };

		expect(body.modelFamily).toBe("");
		expect(result.model).toBe("gpt-5.6-sol");
	});

	it("lists every model family offered by the authenticated Relay", async function ListsModelFamilies(): Promise<void>
	{
		vi.stubEnv("COPILOT_RELAY_SHARED_SECRET", "shared-secret");
		vi.stubGlobal("fetch", async function ReturnModelCatalogue(): Promise<Response>
		{
			const response = new Response(JSON.stringify({ modelFamilies: ["claude-sonnet-4.5", "gpt-4.1"] }), { status: 200 });

			return response;
		});

		const provider = new CopilotRelayModelProvider();
		const modelFamilies = await provider.ListModelFamiliesAsync();

		expect(modelFamilies).toEqual(["claude-sonnet-4.5", "gpt-4.1"]);
	});
});

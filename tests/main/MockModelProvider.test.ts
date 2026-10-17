import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../src/shared/models/ModelTypes.js";
import { MockModelProvider } from "../../src/main/models/MockModelProvider.js";

function CreateRequest(): ModelRequest
{
	const request: ModelRequest = {
		systemPrompt: "System prompt",
		userPrompt: "κατέβην χθὲς εἰς Πειραιᾶ.",
		history: []
	};

	return request;
}

describe("Mock conversation provider", function MockProviderTests()
{
	afterEach(function RestoreEnvironment()
	{
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("returns a deterministic response without network access", async function ReturnsOfflineResponse()
	{
		vi.useFakeTimers();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const provider = new MockModelProvider();
		const firstPromise = provider.CompleteAsync(CreateRequest());
		const secondPromise = provider.CompleteAsync(CreateRequest());

		await vi.advanceTimersByTimeAsync(650);

		const firstResult = await firstPromise;
		const secondResult = await secondPromise;

		expect(fetchMock).not.toHaveBeenCalled();
		expect(firstResult).toEqual(secondResult);
		expect(firstResult.rawText).toContain("κατέβην χθὲς εἰς Πειραιᾶ.");
	});

	it("reports the configured mock failure after simulated latency", async function ReportsMockFailure()
	{
		vi.useFakeTimers();
		vi.stubEnv("MOCK_MODEL_FAILURE", "true");
		const provider = new MockModelProvider();
		const promise = provider.CompleteAsync(CreateRequest());
		const expectation = expect(promise).rejects.toMatchObject({
			code: "mock-failure",
			message: "Mock model failure is enabled by MOCK_MODEL_FAILURE."
		});

		await vi.advanceTimersByTimeAsync(650);
		await expectation;
	});
});

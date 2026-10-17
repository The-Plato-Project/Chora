import { describe, expect, it } from "vitest";
import { IdeaDiscovery, type IdeaPromptAccess, type IdeaSignalAccess } from "../../src/main/ideas/IdeaDiscovery.js";
import type { ModelDeltaHandler, ModelProvider, ModelRequest, ModelResponse } from "../../src/shared/models/ModelTypes.js";
import type { IdeaDiscoveryRequest } from "../../src/shared/ideas/IdeaTypes.js";
import type { SignalRecord } from "../../src/shared/signals/SignalTypes.js";

// Creates one observed or unobserved Signal fixture.
function CreateSignal(id: string, description: string): SignalRecord
{
	const signal: SignalRecord = {
		id,
		workId: "republic",
		sourceRef: `source-${id}`,
		selection: {
			documentId: "republic",
			start: { segmentKey: id, offset: 0 },
			end: { segmentKey: id, offset: id.length }
		},
		text: id,
		description,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01"
	};

	return signal;
}

// Supplies deterministic work-owned Signals to discovery.
class StubSignalAccess implements IdeaSignalAccess
{
	// Lists the configured Signal fixtures.
	public ListAsync(): Promise<SignalRecord[]>
	{
		const signals = [
			CreateSignal("signal-1", "Already connected."),
			CreateSignal("signal-2", "Exchange moves meaning between speakers."),
			CreateSignal("signal-3", "")
		];

		return Promise.resolve(signals);
	}
}

// Supplies the discovery system prompt.
class StubPromptAccess implements IdeaPromptAccess
{
	// Returns the deterministic prompt marker.
	public LoadAsync(): Promise<string>
	{
		const prompt = "IDEA_SIGNAL_DISCOVERY";

		return Promise.resolve(prompt);
	}
}

// Returns configured model output and retains the submitted request.
class StubModelProvider implements ModelProvider
{
	// Identifies this deterministic model.
	public readonly id = "mock" as const;
	// Contains the most recent submitted request.
	public request: ModelRequest | null = null;

	// Returns one valid, one invented, and one weak match.
	public CompleteAsync(request: ModelRequest, _onDelta?: ModelDeltaHandler): Promise<ModelResponse>
	{
		this.request = structuredClone(request);
		const response: ModelResponse = {
			provider: "mock",
			model: "test",
			rawText: JSON.stringify({
				matches: [
					{ candidateId: "candidate-0", relevance: 5, rationale: "The observation treats exchange as movement between sources." },
					{ candidateId: "invented", relevance: 5, rationale: "Invented." },
					{ candidateId: "candidate-0", relevance: 2, rationale: "Too weak." }
				]
			})
		};

		return Promise.resolve(response);
	}
}

describe("IdeaDiscovery", function IdeaDiscoveryTests()
{
	it("returns only high-confidence observed existing Signals", async function DiscoversExistingSignalsAsync()
	{
		const model = new StubModelProvider();
		const discovery = new IdeaDiscovery(new StubSignalAccess(), new StubPromptAccess(), model);
		const request: IdeaDiscoveryRequest = {
			workId: "republic",
			title: "Translation and exchange",
			content: "Meaning is borne from one source to another.",
			originSignal: { signalId: "signal-1" },
			relatedSignals: []
		};

		const suggestions = await discovery.DiscoverAsync(request);

		expect(suggestions).toEqual([{
			reference: { signalId: "signal-2" },
			rationale: "The observation treats exchange as movement between sources."
		}]);
		expect(model.request?.userPrompt).toContain("Exchange moves meaning between speakers.");
		expect(model.request?.userPrompt).not.toContain("Already connected.");
	});
});

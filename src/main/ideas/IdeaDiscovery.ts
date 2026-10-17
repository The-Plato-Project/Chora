import type { IdeaDiscoveryRequest, IdeaDiscoverySuggestion, IdeaSignalReference } from "../../shared/ideas/IdeaTypes.js";
import type { ModelProvider } from "../../shared/models/ModelTypes.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";

// Provides work-owned Signals searched by Idea discovery.
export interface IdeaSignalAccess
{
	// Lists reader-owned Signals for one work.
	ListAsync(workId: string): Promise<SignalRecord[]>;
}

// Provides prompt text without coupling discovery to filesystem access.
export interface IdeaPromptAccess
{
	// Loads one named prompt.
	LoadAsync(promptName: string): Promise<string>;
}

// Contains one model-visible candidate paired with its authoritative Signal identity.
interface DiscoveryCandidate
{
	// Identifies this candidate only within one model request.
	readonly candidateId: string;
	// Identifies the authoritative Dream.
	readonly dreamId: string;
	// Identifies the authoritative Signal.
	readonly signalId: string;
	// Contains the owning Dream title.
	readonly dreamTitle: string;
	// Contains the selected source phrase.
	readonly text: string;
	// Contains the reader-authored observation.
	readonly observation: string;
	// Contains the source locator displayed to the reader.
	readonly locator: string;
}

// Describes one structurally valid model match before candidate validation.
interface DiscoveryMatch
{
	// Identifies one candidate from the submitted batch.
	readonly candidateId: string;
	// Contains the model-assigned confidence from one to five.
	readonly relevance: number;
	// Explains the relationship to the Idea.
	readonly rationale: string;
}

// Pairs one validated suggestion with its model-assigned relevance.
interface RankedSuggestion
{
	// Contains the existing Signal and reader-facing rationale.
	readonly suggestion: IdeaDiscoverySuggestion;
	// Contains the validated high-confidence relevance.
	readonly relevance: number;
}

// Discovers high-confidence relationships among existing reader-authored Signals.
export class IdeaDiscovery
{
	// Maximum candidates sent in one bounded model request.
	private static readonly BatchSize = 25;
	// Maximum validated suggestions returned to the renderer.
	private static readonly ResultLimit = 5;
	// Lowest accepted relevance on the five-point scale.
	private static readonly MinimumRelevance = 4;

	// Creates discovery from explicit Signal, prompt, and model boundaries.
	public constructor(
		private readonly signals: IdeaSignalAccess,
		private readonly prompts: IdeaPromptAccess,
		private readonly model: ModelProvider)
	{
	}

	// Searches every eligible existing Signal and returns the strongest validated matches.
	public async DiscoverAsync(request: IdeaDiscoveryRequest): Promise<IdeaDiscoverySuggestion[]>
	{
		const signals = await this.signals.ListAsync(request.workId);
		const candidates = this.CreateCandidates(request, signals);
		const prompt = await this.prompts.LoadAsync("idea-signal-discovery");
		const ranked: RankedSuggestion[] = [];
		let batchStart = 0;

		while (batchStart < candidates.length)
		{
			const batch = candidates.slice(batchStart, batchStart + IdeaDiscovery.BatchSize);
			const userPrompt = this.CreateUserPrompt(request, batch);
			const response = await this.model.CompleteAsync({
				systemPrompt: prompt,
				userPrompt,
				history: []
			});
			const matches = this.ParseMatches(response.rawText);

			for (const match of matches)
			{
				const candidate = this.FindCandidate(batch, match.candidateId);

				if (candidate !== null)
				{
					ranked.push({
						suggestion: {
							reference: {
								signalId: candidate.signalId
							},
							rationale: match.rationale
						},
						relevance: match.relevance
					});
				}
			}

			batchStart += IdeaDiscovery.BatchSize;
		}

		ranked.sort(this.CompareSuggestions);
		const suggestions = this.TakeDistinctSuggestions(ranked);

		return suggestions;
	}

	// Orders validated suggestions from strongest to weakest relevance.
	private CompareSuggestions(left: RankedSuggestion, right: RankedSuggestion): number
	{
		const comparison = right.relevance - left.relevance;

		return comparison;
	}

	// Creates eligible candidates while excluding unobserved and already-connected Signals.
	private CreateCandidates(request: IdeaDiscoveryRequest, signals: readonly SignalRecord[]): DiscoveryCandidate[]
	{
		const selected = this.CreateSelectedIdentities(request);
		const candidates: DiscoveryCandidate[] = [];

		for (const signal of signals)
		{
			const reference = { signalId: signal.id };
			const identity = this.CreateReferenceIdentity(reference);
			const observation = signal.description.trim();

			if (observation.length > 0 && !selected.has(identity))
			{
				const candidate: DiscoveryCandidate = {
					candidateId: `candidate-${candidates.length}`,
					dreamId: "",
					signalId: signal.id,
					dreamTitle: "Work Signal",
					text: signal.text,
					observation,
					locator: this.CreateSignalLocator(signal)
				};
				candidates.push(candidate);
			}
		}

		return candidates;
	}

	// Creates stable identities for Signals already connected to the Idea.
	private CreateSelectedIdentities(request: IdeaDiscoveryRequest): Set<string>
	{
		const selected = new Set<string>();

		if (request.originSignal !== null)
		{
			selected.add(this.CreateReferenceIdentity(request.originSignal));
		}

		for (const reference of request.relatedSignals)
		{
			selected.add(this.CreateReferenceIdentity(reference));
		}

		return selected;
	}

	// Serializes one bounded discovery request for the model.
	private CreateUserPrompt(request: IdeaDiscoveryRequest, candidates: readonly DiscoveryCandidate[]): string
	{
		const payload = {
			idea: {
				title: request.title,
				description: request.content
			},
			candidates: candidates.map(this.CreateCandidatePayload)
		};
		const prompt = JSON.stringify(payload);

		return prompt;
	}

	// Removes authoritative identifiers from the model-visible candidate payload.
	private CreateCandidatePayload(candidate: DiscoveryCandidate): object
	{
		const payload = {
			candidateId: candidate.candidateId,
			dream: candidate.dreamTitle,
			location: candidate.locator,
			phrase: candidate.text,
			observation: candidate.observation
		};

		return payload;
	}

	// Parses structurally valid high-confidence matches from model JSON.
	private ParseMatches(rawText: string): DiscoveryMatch[]
	{
		const json = this.ExtractJson(rawText);
		const parsed = JSON.parse(json) as unknown;
		const matches: DiscoveryMatch[] = [];

		if (this.IsRecord(parsed) && Array.isArray(parsed.matches))
		{
			for (const value of parsed.matches)
			{
				if (this.IsRecord(value))
				{
					const candidateId = value.candidateId;
					const relevance = value.relevance;
					const rationale = value.rationale;

					if (typeof candidateId === "string"
						&& typeof relevance === "number"
						&& Number.isInteger(relevance)
						&& relevance >= IdeaDiscovery.MinimumRelevance
						&& relevance <= 5
						&& typeof rationale === "string"
						&& rationale.trim().length > 0)
					{
						matches.push({
							candidateId,
							relevance,
							rationale: rationale.trim()
						});
					}
				}
			}
		}

		return matches;
	}

	// Extracts JSON from a plain or fenced model response.
	private ExtractJson(rawText: string): string
	{
		const trimmed = rawText.trim();
		let json = trimmed;

		if (trimmed.startsWith("```"))
		{
			const firstLineEnd = trimmed.indexOf("\n");
			const closingFence = trimmed.lastIndexOf("```");

			if (firstLineEnd >= 0 && closingFence > firstLineEnd)
			{
				json = trimmed.slice(firstLineEnd + 1, closingFence).trim();
			}
		}

		return json;
	}

	// Finds one authoritative candidate submitted in the current batch.
	private FindCandidate(candidates: readonly DiscoveryCandidate[], candidateId: string): DiscoveryCandidate | null
	{
		let found: DiscoveryCandidate | null = null;

		for (const candidate of candidates)
		{
			if (candidate.candidateId === candidateId)
			{
				found = candidate;
			}
		}

		return found;
	}

	// Deduplicates ranked results and enforces the renderer result limit.
	private TakeDistinctSuggestions(ranked: readonly RankedSuggestion[]): IdeaDiscoverySuggestion[]
	{
		const identities = new Set<string>();
		const suggestions: IdeaDiscoverySuggestion[] = [];

		for (const rankedSuggestion of ranked)
		{
			const identity = this.CreateReferenceIdentity(rankedSuggestion.suggestion.reference);

			if (!identities.has(identity) && suggestions.length < IdeaDiscovery.ResultLimit)
			{
				identities.add(identity);
				suggestions.push(structuredClone(rankedSuggestion.suggestion));
			}
		}

		return suggestions;
	}

	// Returns the most precise displayed source location for one Signal.
	private CreateSignalLocator(signal: SignalRecord): string
	{
		const start = signal.sourceRef.trim() || null;
		const end = start;
		let locator = "Source";

		if (start !== null && end !== null && start !== end)
		{
			locator = `${start}-${end}`;
		}
		else if (start !== null)
		{
			locator = start;
		}
		else if (end !== null)
		{
			locator = end;
		}

		return locator;
	}

	// Creates the stable identity used to compare Signal references.
	private CreateReferenceIdentity(reference: IdeaSignalReference): string
	{
		const identity = `signal:${reference.signalId}`;

		return identity;
	}

	// Determines whether an unknown value is a JSON object.
	private IsRecord(value: unknown): value is Record<string, unknown>
	{
		const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);

		return isRecord;
	}
}

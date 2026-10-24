import type { IdeaDiscoverySuggestion, IdeaRecord, IdeaSignalReference } from "../../shared/ideas/IdeaTypes.js";
import type { SessionStore } from "../core/session/SessionStore.js";

// Identifies the visible Ideas editor surface.
export type IdeaView = "editor" | "signals" | "suggestions";

// Represents the lifecycle of one model-assisted discovery request.
export type IdeaDiscoveryState = "idle" | "loading" | "complete" | "error";

// Contains non-authoritative renderer state for editing one Idea.
export interface IdeaDraft
{
	// Identifies an existing Idea or remains null until the main process creates it.
	readonly ideaId: string | null;
	// Identifies the work in which the draft is being edited.
	readonly workId: string;
	// Contains the current reader-authored title.
	readonly title: string;
	// Contains the current reader-authored explanation.
	readonly content: string;
	// Identifies the first connected Signal, or remains null for an empty new draft.
	readonly originSignal: IdeaSignalReference | null;
	// Identifies later Signals connected to the thought.
	readonly relatedSignals: readonly IdeaSignalReference[];
}

export interface IdeaTab
{
	readonly key: string;
	readonly ideaId: string | null;
	readonly title: string;
}

interface IdeaTabsSnapshot
{
	readonly tabs: readonly IdeaDraft[];
	readonly activeKey: string | null;
}

// Removes one Signal reference from one Idea draft and promotes the next reference.
function RemoveSignalFromDraft(draft: IdeaDraft, signalId: string): IdeaDraft
{
	const references = draft.originSignal === null
		? [...draft.relatedSignals]
		: [draft.originSignal, ...draft.relatedSignals];
	const remaining = references.filter(function KeepReference(reference): boolean
	{
		return reference.signalId !== signalId;
	});
	const updated: IdeaDraft = {
		...draft,
		originSignal: remaining[0] ?? null,
		relatedSignals: remaining.slice(1)
	};

	return updated;
}

// Owns all renderer-side Idea state and returns immutable snapshots.
export class IdeaStore
{
	private static readonly SessionKey = "chora:idea-tabs";
	// Identifies the active work.
	private workId: string | null = null;
	// Contains durable Ideas returned by the main process.
	private ideas: readonly IdeaRecord[] = [];
	// Contains the current flat-catalogue search query.
	private catalogueSearch = "";
	// Identifies the visible Ideas editor surface.
	private view: IdeaView = "editor";
	// Contains the current work-wide Signal search query.
	private signalSearch = "";
	// Contains non-authoritative model suggestions awaiting reader acceptance.
	private suggestions: readonly IdeaDiscoverySuggestion[] = [];
	// Tracks the current discovery request state.
	private discoveryState: IdeaDiscoveryState = "idle";
	// Contains the non-authoritative Idea currently being edited.
	private draft: IdeaDraft | null = null;
	// Identifies a Signal waiting for the reader to choose an existing or new Idea.
	private pendingAddReference: IdeaSignalReference | null = null;
	// Contains the current Idea workflow error shown by the editor.
	private error: string | null = null;
	// Ordered Idea drafts represented by the shared document-tab strip.
	private openTabs: IdeaDraft[] = [];
	// Stable key of the active Idea tab; unsaved Ideas use "new".
	private activeTabKey: string | null = null;

	public constructor(private readonly sessions: SessionStore | null = null)
	{
		const snapshot = this.sessions?.Load<IdeaTabsSnapshot>(IdeaStore.SessionKey) ?? null;
		if (snapshot !== null)
		{
			this.openTabs = Array.from(snapshot.tabs, (draft) => structuredClone(draft));
			this.activeTabKey = snapshot.activeKey;
			const active = this.openTabs.find((tab) => this.GetDraftKey(tab) === this.activeTabKey) ?? this.openTabs[0] ?? null;
			if (active !== null)
			{
				this.draft = structuredClone(active);
				this.activeTabKey = this.GetDraftKey(active);
			}
		}
	}

	// Replaces all feature state for the active work.
	public SetWork(workId: string, ideas: readonly IdeaRecord[]): void
	{
		const changedWork = this.workId !== workId;
		this.workId = workId;
		this.ideas = structuredClone(ideas);
		this.pendingAddReference = null;
		this.error = null;

		if (changedWork)
		{
			this.catalogueSearch = "";
			this.signalSearch = "";
			this.suggestions = [];
			this.discoveryState = "idle";
			this.view = "editor";
			this.openTabs = this.openTabs.filter((tab) => tab.workId === workId);
			const active = this.openTabs.find((tab) => this.GetDraftKey(tab) === this.activeTabKey) ?? this.openTabs[0] ?? null;
			this.draft = active === null ? null : structuredClone(active);
			this.activeTabKey = active === null ? null : this.GetDraftKey(active);
			this.PersistTabs();
		}
	}

	public GetOpenTabs(): readonly IdeaTab[]
	{
		this.CaptureActiveTab();
		return this.openTabs.map((draft) => ({
			key: this.GetDraftKey(draft),
			ideaId: draft.ideaId,
			title: draft.title || "New Idea"
		}));
	}

	public HasOpenTab(key: string): boolean
	{
		return this.openTabs.some((draft) => this.GetDraftKey(draft) === key);
	}

	public ActivateTab(key: string): IdeaDraft | null
	{
		this.CaptureActiveTab();
		const draft = this.openTabs.find((candidate) => this.GetDraftKey(candidate) === key) ?? null;
		if (draft !== null)
		{
			this.draft = structuredClone(draft);
			this.activeTabKey = key;
			this.view = "editor";
			this.error = null;
			this.PersistTabs();
		}
		return structuredClone(draft);
	}

	public CloseTab(key: string): IdeaDraft | null
	{
		this.CaptureActiveTab();
		const index = this.openTabs.findIndex((draft) => this.GetDraftKey(draft) === key);
		if (index >= 0)
		{
			this.openTabs.splice(index, 1);
			if (this.activeTabKey === key)
			{
				const next = this.openTabs[Math.min(index, this.openTabs.length - 1)] ?? null;
				this.draft = next === null ? null : structuredClone(next);
				this.activeTabKey = next === null ? null : this.GetDraftKey(next);
				this.view = "editor";
			}
			this.PersistTabs();
		}
		return this.GetDraft();
	}

	// Returns the active work identity.
	public GetWorkId(): string | null
	{
		const workId = this.workId;

		return workId;
	}

	// Returns immutable durable Idea records.
	public GetIdeas(): readonly IdeaRecord[]
	{
		const ideas = structuredClone(this.ideas);

		return ideas;
	}

	// Finds one durable Idea by identity.
	public GetIdea(ideaId: string): IdeaRecord | null
	{
		let found: IdeaRecord | null = null;

		for (const idea of this.ideas)
		{
			if (idea.id === ideaId)
			{
				found = structuredClone(idea);
			}
		}

		return found;
	}

	// Determines whether the submitted identity belongs to a durable Idea.
	public HasIdea(ideaId: string | null): boolean
	{
		let hasIdea = false;

		if (ideaId !== null)
		{
			for (const idea of this.ideas)
			{
				if (idea.id === ideaId)
				{
					hasIdea = true;
				}
			}
		}

		return hasIdea;
	}

	// Returns the current flat-catalogue search query.
	public GetCatalogueSearch(): string
	{
		const search = this.catalogueSearch;

		return search;
	}

	// Records the flat-catalogue search query entered by the reader.
	public SetCatalogueSearch(search: string): void
	{
		this.catalogueSearch = search;
	}

	// Returns the visible Ideas editor surface.
	public GetView(): IdeaView
	{
		const view = this.view;

		return view;
	}

	// Returns the current non-authoritative draft.
	public GetDraft(): IdeaDraft | null
	{
		const draft = structuredClone(this.draft);

		return draft;
	}

	// Returns the current work-wide Signal search query.
	public GetSignalSearch(): string
	{
		const search = this.signalSearch;

		return search;
	}

	// Returns immutable model-assisted Signal suggestions.
	public GetSuggestions(): readonly IdeaDiscoverySuggestion[]
	{
		const suggestions = structuredClone(this.suggestions);

		return suggestions;
	}

	// Returns the current discovery request state.
	public GetDiscoveryState(): IdeaDiscoveryState
	{
		const state = this.discoveryState;

		return state;
	}

	// Returns the Signal waiting to be added through the Ideas catalogue.
	public GetPendingAddReference(): IdeaSignalReference | null
	{
		const reference = structuredClone(this.pendingAddReference);

		return reference;
	}

	// Returns the current user-facing workflow error.
	public GetError(): string | null
	{
		const error = this.error;

		return error;
	}

	// Replaces the active draft and reveals the editor surface.
	public SetDraft(draft: IdeaDraft | null): void
	{
		this.CaptureActiveTab();
		if (draft === null)
		{
			if (this.activeTabKey !== null) this.CloseTab(this.activeTabKey);
			else this.draft = null;
		}
		else
		{
			const next = structuredClone(draft);
			const nextKey = this.GetDraftKey(next);
			const activeIndex = this.openTabs.findIndex((candidate) => this.GetDraftKey(candidate) === this.activeTabKey);
			const existingIndex = this.openTabs.findIndex((candidate) => this.GetDraftKey(candidate) === nextKey);
			if (this.activeTabKey === "new" && nextKey !== "new" && activeIndex >= 0)
			{
				this.openTabs[activeIndex] = next;
			}
			else if (existingIndex >= 0) this.openTabs[existingIndex] = next;
			else this.openTabs.push(next);
			this.draft = next;
			this.activeTabKey = nextKey;
			this.PersistTabs();
		}
		this.pendingAddReference = null;
		this.signalSearch = "";
		this.suggestions = [];
		this.discoveryState = "idle";
		this.error = null;
		this.view = "editor";
	}

	// Reveals the active Idea editor while preserving its draft.
	public ShowEditor(): void
	{
		this.view = "editor";
	}

	// Reveals the Signal browser while preserving the active draft.
	public ShowSignalBrowser(): void
	{
		if (this.draft !== null)
		{
			this.view = "signals";
			this.signalSearch = "";
		}
	}

	// Replaces the work-wide Signal search query.
	public SetSignalSearch(search: string): void
	{
		if (this.view === "signals")
		{
			this.signalSearch = search;
		}
	}

	// Begins a discovery request and clears prior results.
	public SetDiscoveryLoading(): void
	{
		this.view = "suggestions";
		this.discoveryState = "loading";
		this.suggestions = [];
	}

	// Replaces model suggestions with authoritative existing-Signal references.
	public SetSuggestions(suggestions: readonly IdeaDiscoverySuggestion[]): void
	{
		this.suggestions = structuredClone(suggestions);
		this.discoveryState = "complete";
	}

	// Marks model-assisted discovery unavailable without affecting manual search.
	public SetDiscoveryError(): void
	{
		this.suggestions = [];
		this.discoveryState = "error";
	}

	// Replaces reader-editable text on the active draft.
	public UpdateDraft(title: string, content: string): void
	{
		if (this.draft !== null)
		{
			this.draft = {
				...this.draft,
				title,
				content
			};
			this.CaptureActiveTab();
			this.PersistTabs();
		}
	}

	// Connects one distinct Signal, using the first Signal as the internal origin.
	public AddSignal(reference: IdeaSignalReference): void
	{
		if (this.draft !== null)
		{
			const identity = this.CreateReferenceIdentity(reference);
			const originIdentity = this.draft.originSignal === null
				? null
				: this.CreateReferenceIdentity(this.draft.originSignal);
			const relatedSignals: IdeaSignalReference[] = [];
			let isKnown = identity === originIdentity;

			for (const candidate of this.draft.relatedSignals)
			{
				const candidateIdentity = this.CreateReferenceIdentity(candidate);
				const clonedCandidate = structuredClone(candidate);
				relatedSignals.push(clonedCandidate);

				if (candidateIdentity === identity)
				{
					isKnown = true;
				}
			}

			if (this.draft.originSignal === null)
			{
				this.draft = {
					...this.draft,
					originSignal: structuredClone(reference)
				};
			}
			else if (!isKnown)
			{
				relatedSignals.push(structuredClone(reference));
				this.draft = {
					...this.draft,
					relatedSignals
				};
			}
			this.CaptureActiveTab();
			this.PersistTabs();
		}
	}

	// Removes one connected Signal and promotes the next association when necessary.
	public RemoveSignal(reference: IdeaSignalReference): void
	{
		if (this.draft !== null)
		{
			const identity = this.CreateReferenceIdentity(reference);
			const remaining: IdeaSignalReference[] = [];

			if (this.draft.originSignal !== null
				&& this.CreateReferenceIdentity(this.draft.originSignal) !== identity)
			{
				remaining.push(structuredClone(this.draft.originSignal));
			}

			for (const candidate of this.draft.relatedSignals)
			{
				if (this.CreateReferenceIdentity(candidate) !== identity)
				{
					remaining.push(structuredClone(candidate));
				}
			}

			this.draft = {
				...this.draft,
				originSignal: remaining[0] ?? null,
				relatedSignals: remaining.slice(1)
			};
			this.CaptureActiveTab();
			this.PersistTabs();
		}
	}

	// Removes one deleted Signal from durable Ideas, open drafts, and transient discovery state.
	public RemoveSignalEverywhere(signalId: string): void
	{
		this.ideas = this.ideas.map(function RemoveFromIdea(idea): IdeaRecord
		{
			const references = idea.originSignal === null
				? [...idea.relatedSignals]
				: [idea.originSignal, ...idea.relatedSignals];
			const remaining = references.filter(function KeepReference(reference): boolean
			{
				return reference.signalId !== signalId;
			});

			return {
				...idea,
				originSignal: remaining[0] ?? null,
				relatedSignals: remaining.slice(1)
			};
		});
		this.openTabs = this.openTabs.map(function RemoveFromDraft(draft): IdeaDraft
		{
			return RemoveSignalFromDraft(draft, signalId);
		});
		if (this.draft !== null) this.draft = RemoveSignalFromDraft(this.draft, signalId);
		if (this.pendingAddReference?.signalId === signalId) this.pendingAddReference = null;
		this.suggestions = this.suggestions.filter(function KeepSuggestion(suggestion): boolean
		{
			return suggestion.reference.signalId !== signalId;
		});
		this.PersistTabs();
	}

	// Begins the workflow for attaching one Signal through the normal Ideas catalogue.
	public BeginAddToIdea(reference: IdeaSignalReference): void
	{
		this.pendingAddReference = structuredClone(reference);
		this.error = null;
	}

	// Cancels the pending Add to Idea workflow.
	public CancelPendingAdd(): void
	{
		this.pendingAddReference = null;
	}

	// Replaces one durable Idea with the authoritative saved record.
	public ReplaceSaved(saved: IdeaRecord): void
	{
		const ideas: IdeaRecord[] = [];

		for (const idea of this.ideas)
		{
			if (idea.id !== saved.id)
			{
				ideas.push(idea);
			}
		}

		ideas.push(structuredClone(saved));
		this.ideas = ideas;

		if (this.draft !== null && this.draft.ideaId === saved.id)
		{
			this.draft = this.CreateDraft(saved);
			this.CaptureActiveTab();
		}

		this.error = null;
		this.PersistTabs();
	}

	// Removes one durable Idea and its active draft.
	public RemoveIdea(ideaId: string): void
	{
		const ideas: IdeaRecord[] = [];

		for (const idea of this.ideas)
		{
			if (idea.id !== ideaId)
			{
				ideas.push(idea);
			}
		}

		this.ideas = ideas;

		if (this.draft !== null && this.draft.ideaId === ideaId)
		{
			this.CloseTab(ideaId);
		}
		else
		{
			this.openTabs = this.openTabs.filter((draft) => draft.ideaId !== ideaId);
			this.PersistTabs();
		}
	}

	// Records a user-facing Idea persistence or attachment error.
	public SetError(message: string): void
	{
		this.error = message;
	}

	// Converts one authoritative Idea record into a renderer-owned draft.
	public CreateDraft(record: IdeaRecord): IdeaDraft
	{
		const draft: IdeaDraft = {
			ideaId: record.id,
			workId: record.workId,
			title: record.title,
			content: record.content,
			originSignal: structuredClone(record.originSignal),
			relatedSignals: structuredClone(record.relatedSignals)
		};

		return draft;
	}

	// Creates the stable identity used to compare Signal references.
	private CreateReferenceIdentity(reference: IdeaSignalReference): string
	{
		const identity = `signal:${reference.signalId}`;

		return identity;
	}

	private GetDraftKey(draft: IdeaDraft): string
	{
		return draft.ideaId ?? "new";
	}

	private CaptureActiveTab(): void
	{
		if (this.draft !== null && this.activeTabKey !== null)
		{
			const index = this.openTabs.findIndex((candidate) => this.GetDraftKey(candidate) === this.activeTabKey);
			if (index >= 0) this.openTabs[index] = structuredClone(this.draft);
		}
	}

	private PersistTabs(): void
	{
		if (this.sessions !== null)
		{
			const snapshot: IdeaTabsSnapshot = {
				tabs: structuredClone(this.openTabs),
				activeKey: this.activeTabKey
			};
			this.sessions.Save(IdeaStore.SessionKey, snapshot);
		}
	}
}

// Identifies one reader-authored Signal that supports an Idea.
export interface IdeaSignalReference
{
	// Identifies one work-owned Signal.
	readonly signalId: string;
	// Explains why this Signal bears on its owning Idea, without changing the shared Signal.
	readonly rationale?: string | null;
}

// Represents one durable work-owned Idea returned by the main process.
export interface IdeaRecord
{
	// Identifies the Idea.
	readonly id: string;
	// Identifies the work that owns the Idea.
	readonly workId: string;
	// Contains the reader-authored Idea title.
	readonly title: string;
	// Contains the reader-authored Idea explanation.
	readonly content: string;
	// Identifies the Signal from which the Idea first emerged.
	readonly originSignal: IdeaSignalReference | null;
	// Identifies later Signals connected to the Idea.
	readonly relatedSignals: readonly IdeaSignalReference[];
	// Records when the main process created the Idea.
	readonly createdAt: string;
	// Records when the main process most recently saved the Idea.
	readonly updatedAt: string;
}

// Carries reader-editable Idea data to the main process without authoritative metadata.
export interface SaveIdeaCommand
{
	// Identifies an existing Idea or remains null for a new Idea.
	readonly ideaId: string | null;
	// Identifies the work in which the Idea is being edited.
	readonly workId: string;
	// Contains the reader-authored Idea title.
	readonly title: string;
	// Contains the reader-authored Idea explanation.
	readonly content: string;
	// Identifies the Signal from which a new Idea first emerged.
	readonly originSignal: IdeaSignalReference | null;
	// Identifies later Signals connected to the Idea.
	readonly relatedSignals: readonly IdeaSignalReference[];
}

// Identifies the durable Idea that the reader wants to delete.
export interface DeleteIdeaCommand
{
	// Identifies the work that owns the Idea.
	readonly workId: string;
	// Identifies the Idea to delete.
	readonly ideaId: string;
}

// Carries one described Idea and its connected Signals into model-assisted discovery.
export interface IdeaDiscoveryRequest
{
	// Identifies the work whose existing Signals may be searched.
	readonly workId: string;
	// Contains the current reader-authored Idea title.
	readonly title: string;
	// Contains the current reader-authored Idea explanation.
	readonly content: string;
	// Identifies the first connected Signal when the draft has one.
	readonly originSignal: IdeaSignalReference | null;
	// Identifies later Signals already connected by the reader.
	readonly relatedSignals: readonly IdeaSignalReference[];
}

// Represents one existing Signal proposed by discovery but not yet connected.
export interface IdeaDiscoverySuggestion
{
	// Identifies the existing reader-authored Signal.
	readonly reference: IdeaSignalReference;
	// Explains why the Signal bears on the Idea.
	readonly rationale: string;
}

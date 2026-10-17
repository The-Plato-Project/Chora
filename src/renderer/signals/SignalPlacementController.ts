import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { DreamController } from "../dreams/DreamController.js";
import type { DreamStore } from "../dreams/DreamStore.js";
import type { IdeaController } from "../ideas/IdeaController.js";
import type { IdeaStore } from "../ideas/IdeaStore.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import type { SignalController } from "./SignalController.js";
import type { SignalStore } from "./SignalStore.js";

export type SignalDestinationKind = "dream" | "idea";

export interface SignalDestination
{
	readonly kind: SignalDestinationKind;
	readonly id: string;
	readonly title: string;
	readonly signalId: string | null;
}

// Resolves a selected passage to the DreamView or Idea where its Signal belongs.
export class SignalPlacementController
{
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly library: LibraryStore,
		private readonly dreamStore: DreamStore,
		private readonly dreams: DreamController,
		private readonly ideaStore: IdeaStore,
		private readonly ideas: IdeaController,
		private readonly signalStore: SignalStore,
		private readonly signals: SignalController)
	{
	}

	// Returns every existing document that can own the selected Signal.
	public GetDestinations(selection: TextSelection): readonly SignalDestination[]
	{
		const destinations: SignalDestination[] = [];
		const document = this.library.GetText();
		const matches = this.signalStore.FindMatching(selection);
		const matchingIds = new Set(matches.map(function GetSignalId(signal): string
		{
			return signal.id;
		}));

		if (document !== null && document.id === selection.documentId)
		{
			for (const dream of this.dreamStore.GetCatalogue())
			{
				if (dream.workId === document.id && document.Contains(selection, dream.source))
				{
					const signal = dream.signals.find(function FindSignal(candidate): boolean
					{
						return matchingIds.has(candidate.id);
					});
					destinations.push({
						kind: "dream",
						id: dream.id,
						title: dream.title.trim() || "Untitled Dream",
						signalId: signal?.id ?? null
					});
				}
			}
		}

		for (const idea of this.ideaStore.GetIdeas())
		{
			if (idea.workId !== selection.documentId) continue;
			const references = idea.originSignal === null
				? idea.relatedSignals
				: [idea.originSignal, ...idea.relatedSignals];
			const reference = references.find(function FindReference(candidate): boolean
			{
				return matchingIds.has(candidate.signalId);
			});
			if (reference !== undefined)
			{
				destinations.push({
					kind: "idea",
					id: idea.id,
					title: idea.title.trim() || "Untitled Idea",
					signalId: reference.signalId
				});
			}
		}

		return destinations;
	}

	// Opens one destination, creates a Signal when needed, and reveals its editable association.
	public async PlaceAsync(selection: TextSelection, destination: SignalDestination): Promise<void>
	{
		let signal: SignalRecord | null = destination.signalId === null
			? null
			: this.signalStore.GetSignal(destination.signalId);

		if (signal === null) signal = await this.signals.CreateAsync(selection);

		if (signal !== null && destination.kind === "dream")
		{
			if (destination.signalId === signal.id)
			{
				await this.dreams.OpenSignalAsync(destination.id, signal.id);
			}
			else
			{
				this.dreams.Open(destination.id);
				await this.dreams.AssociateSignalAsync(signal);
			}
		}
		else if (signal !== null)
		{
			this.ideas.Edit(destination.id);
			this.ideas.AddSignal({ signalId: signal.id });
			await this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
			await this.events.PublishAsync("idea.signal-focus-requested", { ideaId: destination.id, signalId: signal.id });
		}
	}

	// Creates a new DreamView around the selected passage and adds its first Signal.
	public async CreateDreamAsync(selection: TextSelection): Promise<void>
	{
		await this.dreams.Create(selection);
		const signal = await this.signals.CreateAsync(selection);

		if (signal !== null) await this.dreams.AssociateSignalAsync(signal);
	}

	// Creates a new Idea draft whose first relationship is the selected Signal.
	public async CreateIdeaAsync(selection: TextSelection): Promise<void>
	{
		const signal = await this.signals.CreateAsync(selection);

		if (signal !== null) await this.ideas.CreateFromSignalAsync({ signalId: signal.id });
		if (signal !== null)
		{
			await this.events.PublishAsync("workspace.document-selected", { kind: "idea" });
			await this.events.PublishAsync("idea.signal-focus-requested", { ideaId: null, signalId: signal.id });
		}
	}
}

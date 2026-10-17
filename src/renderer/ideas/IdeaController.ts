import type { DeleteIdeaCommand, IdeaDiscoveryRequest, IdeaSignalReference, SaveIdeaCommand } from "../../shared/ideas/IdeaTypes.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { IdeaGateway } from "./IdeaGateway.js";
import { IdeaStore, type IdeaDraft, type IdeaTab } from "./IdeaStore.js";

// Coordinates renderer-side Idea workflows without owning persistence authority.
export class IdeaController
{
	// Creates the Idea workflow coordinator and its typed collaborators.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly store: IdeaStore,
		private readonly gateway: IdeaGateway)
	{
	}

	// Loads durable Ideas belonging to the active work.
	public async LoadAsync(workId: string): Promise<void>
	{
		try
		{
			const ideas = await this.gateway.ListAsync(workId);
			this.store.SetWork(workId, ideas);
			await this.PublishChangedAsync();
		}
		catch (error)
		{
			this.Report(error, "Unable to load Ideas for this work.");
		}
	}

	// Starts an empty unsaved Idea draft for the active work.
	public async CreateAsync(): Promise<void>
	{
		const workId = this.store.GetWorkId();

		if (workId !== null)
		{
			const draft: IdeaDraft = {
				ideaId: null,
				workId,
				title: "",
				content: "",
				originSignal: null,
				relatedSignals: []
			};
			this.store.SetDraft(draft);
			await this.PublishChangedAsync();
		}
	}

	// Starts an unsaved Idea draft with one existing Signal already connected.
	public async CreateFromSignalAsync(reference: IdeaSignalReference): Promise<void>
	{
		const workId = this.store.GetWorkId();

		if (workId !== null)
		{
			const draft: IdeaDraft = {
				ideaId: null,
				workId,
				title: "",
				content: "",
				originSignal: structuredClone(reference),
				relatedSignals: []
			};
			this.store.SetDraft(draft);
			await this.PublishChangedAsync();
		}
	}

	// Returns from the Signal browser to the active Idea editor.
	public ShowEditor(): void
	{
		this.store.ShowEditor();
		const publication = this.PublishChangedAsync();
		void publication;
	}

	// Opens the searchable Signal browser for the active Idea.
	public OpenSignalBrowser(): void
	{
		this.store.ShowSignalBrowser();
		const publication = this.PublishChangedAsync();
		void publication;
	}

	// Runs model-assisted discovery against existing observed Signals.
	public async FindSignalsAsync(): Promise<void>
	{
		const draft = this.store.GetDraft();
		const hasDescription = draft !== null
			&& (draft.title.trim().length > 0 || draft.content.trim().length > 0);

		if (draft !== null && hasDescription)
		{
			const request: IdeaDiscoveryRequest = {
				workId: draft.workId,
				title: draft.title,
				content: draft.content,
				originSignal: draft.originSignal,
				relatedSignals: draft.relatedSignals
			};
			this.store.SetDiscoveryLoading();
			await this.PublishChangedAsync();

			try
			{
				const suggestions = await this.gateway.DiscoverAsync(request);
				this.store.SetSuggestions(suggestions);
			}
			catch (error)
			{
				this.store.SetDiscoveryError();
				this.errors.Error("IdeaController", "Signal discovery failed.", error);
			}

			await this.PublishChangedAsync();
		}
	}

	// Updates the Signal-browser search without rebuilding the whole editor.
	public UpdateSignalSearch(search: string): void
	{
		this.store.SetSignalSearch(search);
	}

	// Begins selection of a durable or new Idea for one Signal.
	public BeginAddToIdea(reference: IdeaSignalReference): void
	{
		this.store.BeginAddToIdea(reference);
		const publication = this.PublishChangedAsync();
		void publication;
	}

	// Cancels the pending Add to Idea workflow.
	public CancelAddToIdea(): void
	{
		this.store.CancelPendingAdd();
		const publication = this.PublishChangedAsync();
		void publication;
	}

	// Creates and immediately persists a new Idea from the pending Signal.
	public async CreateIdeaFromPendingSignalAsync(): Promise<boolean>
	{
		const reference = this.store.GetPendingAddReference();
		let saved = false;

		if (reference !== null)
		{
			await this.CreateFromSignalAsync(reference);
			saved = await this.SaveAsync();
		}

		return saved;
	}

	// Adds the pending Signal to one selected durable Idea.
	public async AddPendingSignalToIdeaAsync(ideaId: string): Promise<void>
	{
		const reference = this.store.GetPendingAddReference();

		if (reference !== null) await this.AddSignalToIdeaAsync(ideaId, reference);
	}

	// Adds one explicit Signal directly to a durable Idea without opening the catalogue picker.
	public async AddSignalToIdeaAsync(ideaId: string, reference: IdeaSignalReference): Promise<void>
	{
		const idea = this.store.GetIdea(ideaId);

		if (reference !== null && idea !== null && !this.ContainsSignal(idea.originSignal, idea.relatedSignals, reference))
		{
			const originSignal = idea.originSignal ?? reference;
			const relatedSignals = idea.originSignal === null
				? [...idea.relatedSignals]
				: this.AddDistinctRelatedSignal(idea.originSignal, idea.relatedSignals, reference);
			const command: SaveIdeaCommand = {
				ideaId: idea.id,
				workId: idea.workId,
				title: idea.title,
				content: idea.content,
				originSignal,
				relatedSignals
			};

			try
			{
				const saved = await this.gateway.SaveAsync(command);
				this.store.ReplaceSaved(saved);
				const draft = this.store.CreateDraft(saved);
				this.store.SetDraft(draft);
				await this.PublishChangedAsync();
			}
			catch (error)
			{
				this.store.SetError("Unable to add this Signal to the Idea.");
				this.Report(error, "Unable to add this Signal to the Idea.");
				await this.PublishChangedAsync();
			}
		}
	}

	// Opens one durable Idea as a non-authoritative renderer draft.
	public Edit(ideaId: string): void
	{
		if (this.store.HasOpenTab(ideaId))
		{
			this.store.ActivateTab(ideaId);
			void this.PublishChangedAsync();
			return;
		}
		const idea = this.store.GetIdea(ideaId);
		let draft: IdeaDraft | null = null;

		if (idea !== null)
		{
			draft = this.store.CreateDraft(idea);
		}

		this.store.SetDraft(draft);
		const publication = this.PublishChangedAsync();
		void publication;
	}

	public GetOpenTabs(): readonly IdeaTab[]
	{
		return this.store.GetOpenTabs();
	}

	public ActivateTab(key: string): void
	{
		if (this.store.ActivateTab(key) !== null) void this.PublishChangedAsync();
	}

	public CloseTab(key: string): void
	{
		this.store.CloseTab(key);
		void this.PublishChangedAsync();
	}

	// Updates reader-editable text without rerendering the active editor.
	public Update(title: string, content: string): void
	{
		this.store.UpdateDraft(title, content);
		void this.events.PublishAsync("idea.draft-changed", {});
	}

	// Updates the active Idea title without replacing its Seeing.
	public UpdateTitle(title: string): void
	{
		const draft = this.store.GetDraft();

		if (draft !== null)
		{
			this.Update(title, draft.content);
		}
	}

	// Updates the active Idea's reader-authored Seeing without replacing its title.
	public UpdateSeeing(content: string): void
	{
		const draft = this.store.GetDraft();

		if (draft !== null)
		{
			this.Update(draft.title, content);
		}
	}

	// Connects one existing Signal to the active draft.
	public AddSignal(reference: IdeaSignalReference): void
	{
		this.store.AddSignal(reference);
		const publication = this.PublishChangedAsync();
		void publication;
	}

	// Returns the Idea-owned rationale for one connected Signal.
	public GetSignalRationale(signalId: string): string | null
	{
		const draft = this.store.GetDraft();
		const references = draft?.originSignal === null || draft?.originSignal === undefined
			? draft?.relatedSignals ?? []
			: [draft.originSignal, ...draft.relatedSignals];
		const reference = references.find(function FindReference(candidate): boolean
		{
			return candidate.signalId === signalId;
		});
		const rationaleText = reference?.rationale?.trim() ?? "";
		const rationale = rationaleText.length > 0 ? rationaleText : null;

		return rationale;
	}

	// Removes one connected Signal from the active draft.
	public RemoveSignal(reference: IdeaSignalReference): void
	{
		this.store.RemoveSignal(reference);
		const publication = this.PublishChangedAsync();
		void publication;
	}

	// Opens one referenced Signal in the established Signal panel without replacing the reader.
	public async ViewSignalAsync(reference: IdeaSignalReference): Promise<void>
	{
		await this.events.PublishAsync("idea.signal-view-requested", reference);
	}

	// Saves the active draft, including a Signal-free placeholder.
	public async SaveAsync(): Promise<boolean>
	{
		const draft = this.store.GetDraft();
		const canSave = draft !== null;
		let savedSuccessfully = false;

		if (draft !== null && canSave)
		{
			const command: SaveIdeaCommand = {
				ideaId: draft.ideaId,
				workId: draft.workId,
				title: draft.title,
				content: draft.content,
				originSignal: draft.originSignal,
				relatedSignals: draft.relatedSignals
			};

			try
			{
				const saved = await this.gateway.SaveAsync(command);
				this.store.ReplaceSaved(saved);
				const savedDraft = this.store.CreateDraft(saved);
				this.store.SetDraft(savedDraft);
				await this.PublishChangedAsync();
				savedSuccessfully = true;
			}
			catch (error)
			{
				this.store.SetError("Unable to save this Idea.");
				this.Report(error, "Unable to save this Idea.");
				await this.PublishChangedAsync();
			}
		}

		return savedSuccessfully;
	}

	// Deletes the durable Idea represented by the active draft.
	public async DeleteAsync(): Promise<boolean>
	{
		const draft = this.store.GetDraft();
		const ideaId = draft?.ideaId ?? null;
		const isSaved = this.store.HasIdea(ideaId);
		let deleted = false;

		if (draft !== null && ideaId !== null && isSaved)
		{
			const command: DeleteIdeaCommand = {
				workId: draft.workId,
				ideaId
			};

			try
			{
				await this.gateway.DeleteAsync(command);
				this.store.RemoveIdea(ideaId);
				await this.PublishChangedAsync();
				deleted = true;
			}
			catch (error)
			{
				this.Report(error, "Unable to delete this Idea.");
			}
		}

		return deleted;
	}

	// Adds one Signal unless it is already the origin or connected evidence.
	private AddDistinctRelatedSignal(
		originSignal: IdeaSignalReference,
		relatedSignals: readonly IdeaSignalReference[],
		reference: IdeaSignalReference): IdeaSignalReference[]
	{
		const identity = this.CreateReferenceIdentity(reference);
		const originIdentity = this.CreateReferenceIdentity(originSignal);
		const combined: IdeaSignalReference[] = [];
		let isIncluded = identity === originIdentity;

		for (const candidate of relatedSignals)
		{
			const candidateIdentity = this.CreateReferenceIdentity(candidate);
			combined.push(structuredClone(candidate));

			if (candidateIdentity === identity)
			{
				isIncluded = true;
			}
		}

		if (!isIncluded)
		{
			combined.push(structuredClone(reference));
		}

		return combined;
	}

	// Determines whether one Signal already belongs to an Idea.
	private ContainsSignal(
		originSignal: IdeaSignalReference | null,
		relatedSignals: readonly IdeaSignalReference[],
		reference: IdeaSignalReference): boolean
	{
		const identity = this.CreateReferenceIdentity(reference);
		const originIdentity = originSignal === null ? null : this.CreateReferenceIdentity(originSignal);
		let isIncluded = originIdentity !== null && identity === originIdentity;

		for (const candidate of relatedSignals)
		{
			const candidateIdentity = this.CreateReferenceIdentity(candidate);

			if (candidateIdentity === identity)
			{
				isIncluded = true;
			}
		}

		return isIncluded;
	}

	// Creates the stable identity used to compare Signal references.
	private CreateReferenceIdentity(reference: IdeaSignalReference): string
	{
		const identity = `signal:${reference.signalId}`;

		return identity;
	}

	// Publishes the completed renderer state change.
	private PublishChangedAsync(): Promise<void>
	{
		const publication = this.events.PublishAsync("ideas.changed", {});

		return publication;
	}

	// Reports an Idea workflow failure through the shared error owner.
	private Report(error: unknown, userMessage: string): void
	{
		this.errors.Report("IdeaController", error, userMessage);
	}
}

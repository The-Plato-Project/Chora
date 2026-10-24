import { CreateDreamSnapshot, CreateDreamView, type DreamView } from "./DreamView.js";
import type { TextDocument } from "../../shared/library/LibraryTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import { GetSignalAnchor, HasSignalSelection, IsValidSignalSelection } from "../../shared/signals/SignalSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { SignalStore } from "../signals/SignalStore.js";
import { SignalDescriptionSaveQueue } from "../signals/SignalDescriptionSaveQueue.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { CreateDreamTextSelection } from "./DreamTextSelection.js";
import { DreamMarkdownExport } from "../../shared/dreams/DreamMarkdownExport.js";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { DreamGateway } from "./DreamGateway.js";
import { DreamStore, type DreamChange, type DreamSaveState, type DreamTab } from "./DreamStore.js";

// A division of a document (e.g. "Book 4"), used to place a Dream in the catalogue.
type DreamDivision = { type: string; label: string };

// A group of catalogue Dreams presented under one division heading, or one ungrouped list when no division data exists.
export interface DreamCatalogueGroup
{
	// Display heading for the group, or empty when Dreams are not grouped by division.
	readonly label: string;
	// Identifier of the book division this group belongs to, or null when this is not a book-level group.
	readonly book: string | null;
	// Dreams belonging to this group, already ordered by source position.
	readonly dreams: readonly DreamView[];
}

// Coordinates DreamView workflows between the reader's catalogue, the active editing session, and the main process.
export class DreamController
{
	// Serializes canonical Signal-description writes so stale responses never replace local typing.
	private readonly signalDescriptionSaves = new SignalDescriptionSaveQueue();
	// Delay before an idle mutation triggers an automatic save.
	private static readonly AutosaveDelayMilliseconds = 750;
	// Pending autosave timer, or null when nothing is scheduled.
	private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	// The save currently writing to disk, or null when no save is in flight.
	private activeSave: Promise<void> | null = null;
	// Set while a delete is in progress so a concurrent save cannot resurrect the DreamView.
	private isDeleting = false;
	private readonly creatingSynopticViewDreamIds = new Set<string>();
	private readonly cancelledSynopticViewDreamIds = new Set<string>();

	// Creates the controller and subscribes to the application events it coordinates.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly library: LibraryStore,
		private readonly store: DreamStore,
		private readonly gateway: DreamGateway,
		private readonly signals: SignalStore | null = null)
	{
		this.events.Subscribe("dream.create-requested", this.HandleCreateRequested.bind(this));
		this.events.Subscribe("dream.signal-add-requested", this.HandleSignalAddRequested.bind(this));
		this.events.Subscribe("dream.source-extend-requested", this.HandleSourceExtendRequestedAsync.bind(this));
		this.events.Subscribe("dream.passage-filter-requested", this.HandlePassageFilterRequestedAsync.bind(this));
		this.events.Subscribe("library.text-opened", this.HandleFilterTextOpened.bind(this));
		this.events.Subscribe("signal.changed", this.HandleSignalChangedAsync.bind(this));
		this.events.Subscribe("signal.deleted", this.HandleSignalDeletedAsync.bind(this));
	}

	// Resolves a clicked passage against the current work before applying its source filter.
	private async HandlePassageFilterRequestedAsync(event: ChoraEvents["dream.passage-filter-requested"]): Promise<void>
	{
		const document = this.library.GetText();
		if (document !== null && document.id === event.workId)
		{
			for (const segment of document.segments)
			{
				if (segment.key === event.segmentKey && segment.citation !== null)
				{
					const label = `${document.title} · ${segment.citation.value}`;
					this.store.SetPassageFilter({ workId: document.id, segmentKey: segment.key, label });
					this.store.SetSearchText("");
					await this.events.PublishAsync("dream.passage-filter-changed", {});
					break;
				}
			}
		}
	}

	// Refreshes the catalogue and removes stale filters when a text opens.
	private HandleFilterTextOpened(): void
	{
		this.store.SetSearchText("");
		const filter = this.store.GetPassageFilter();
		const text = this.library.GetText();
		if (filter !== null && filter.workId !== text?.id)
		{
			void this.ClearPassageFilterAsync();
		}
		void this.RefreshAsync();
	}

	// Clears source filtering while retaining any keyword query entered within it.
	public async ClearPassageFilterAsync(): Promise<void>
	{
		this.store.SetPassageFilter(null);
		await this.events.PublishAsync("dream.passage-filter-changed", {});
	}

	// Supplies per-passage counts for the reading pane without exposing catalogue ownership.
	public GetPassageCounts(): ReadonlyMap<string, number>
	{
		const document = this.library.GetText();
		let counts: ReadonlyMap<string, number> = new Map<string, number>();
		if (document !== null)
		{
			counts = this.store.GetPassageCounts(document);
		}
		return counts;
	}

	// Supplies associated DreamView titles for reading-pane passage tooltips.
	public GetPassageDreamTitles(): ReadonlyMap<string, readonly string[]>
	{
		const document = this.library.GetText();
		let titles: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>();
		if (document !== null)
		{
			titles = this.store.GetPassageDreamTitles(document);
		}
		return titles;
	}

	// Loads the catalogue and reopens any DreamView restored from a prior session.
	public async StartAsync(): Promise<void>
	{
		try
		{
			await this.RefreshAsync();
			const activeDream = this.store.GetActiveDream();

			if (activeDream !== null)
			{
				await this.events.PublishAsync("dream.opened", {});
				if (this.store.GetIsDirty()) this.ScheduleAutosave();
			}
		}
		catch (error)
		{
			const message = this.CreateFailureMessage("Unable to load Dreams", error);
			this.errors.Report("DreamController", error, message);
		}
	}

	// Reloads the DreamView catalogue from the main process and publishes a change notice when it differs.
	public async RefreshAsync(): Promise<void>
	{
		try
		{
			const snapshots = await this.gateway.ListAsync();
			const catalogue = this.CreateViews(snapshots);
			const hasChanged = JSON.stringify(this.store.GetCatalogue()) !== JSON.stringify(catalogue);

			if (hasChanged)
			{
				this.store.SetCatalogue(catalogue);
				await this.events.PublishAsync("dream.catalogue-changed", { count: catalogue.length });
			}
		}
		catch (error)
		{
			const message = this.CreateFailureMessage("Unable to refresh Dreams", error);
			this.errors.Report("DreamController", error, message);
		}
	}

	// Includes the actionable underlying cause in one user-facing operation failure.
	private CreateFailureMessage(prefix: string, error: unknown): string
	{
		const detail = error instanceof Error ? error.message : String(error);
		const message = `${prefix}: ${detail}`;

		return message;
	}

	// Creates a new DreamView from the reader's current passage selection, or reports why none is available.
	public async CreateFromCurrentSelection(): Promise<void>
	{
		const selection = this.library.GetContextSelection();

		if (selection !== null) await this.Create(selection);
		else this.errors.Report("DreamController", new Error("No passage available."), "Open a text to begin a Dream.");
	}

	// Opens a new, unsaved DreamView anchored to the given passage selection.
	public async Create(selection: TextSelection): Promise<void>
	{
		const document = this.library.GetText();

		if (document !== null)
		{
			const timestamp = new Date().toISOString();
			const id = await this.gateway.AllocateIdAsync();
			const dream: DreamView = {
				id,
				workId: document.id,
				dialogue: document.title,
				title: "",
				source: document.CreateSelection(selection.start, selection.end),
				signalIds: [],
				signals: [],
				reflection: "",
				synopticView: "",
				linkedDreamIds: [],
				createdAt: timestamp,
				updatedAt: timestamp
			};

			this.store.Open(dream, true);
			void this.events.PublishAsync("dream.opened", {});
		}
	}

	// Opens an existing DreamView from the catalogue for editing.
	public Open(dreamId: string): void
	{
		const dream = this.OpenDream(dreamId);

		if (dream !== null) void this.events.PublishAsync("dream.opened", {});
	}

	// Opens a DreamView, then reveals one specific signal.
	public async OpenSignalAsync(dreamId: string, signalId: string): Promise<void>
	{
		const dream = this.OpenDream(dreamId);

		if (dream !== null)
		{
			await this.events.PublishAsync("dream.opened", {});
			await this.events.PublishAsync("dream.signal-focus-requested", { dreamId, signalId });
		}
	}

	// Returns an immutable snapshot of the active DreamView, or null when none is open.
	public GetActiveDream(): DreamView | null
	{
		const dream = this.store.GetActiveDream();

		return dream;
	}

	// Returns ordered descriptors for the open DreamView editor tabs.
	public GetOpenTabs(): readonly DreamTab[]
	{
		const tabs = this.store.GetOpenTabs();

		return tabs;
	}

	// Remembers the selected Signal within one DreamView tab.
	public RememberSelectedSignal(dreamId: string, signalId: string | null): void
	{
		this.store.SetSelectedSignal(dreamId, signalId);
	}

	// Returns the Signal selection remembered within one DreamView tab.
	public GetSelectedSignal(dreamId: string): string | null
	{
		const signalId = this.store.GetSelectedSignal(dreamId);

		return signalId;
	}

	// Scrolls the reader to one Signal associated with the active DreamView.
	public async ViewSignalAsync(signalId: string): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		let signal: SignalRecord | null = null;

		for (const candidate of dream?.signals ?? [])
		{
			if (candidate.id === signalId) signal = candidate;
		}

		if (signal !== null)
		{
			await this.events.PublishAsync("library.jump-requested", { selections: signal.selections, target: "signal" });
		}
	}

	// Remembers the selected inner editor tab for one DreamView.
	public RememberEditorTab(dreamId: string, tabId: string): void
	{
		this.store.SetEditorTab(dreamId, tabId);
	}

	// Returns the selected inner editor tab remembered for one DreamView.
	public GetEditorTab(dreamId: string): string
	{
		const tabId = this.store.GetEditorTab(dreamId);

		return tabId;
	}

	// Opens a DreamView from the catalogue into the active editing session, without publishing that it opened.
	private OpenDream(dreamId: string): DreamView | null
	{
		const dream = this.FindCatalogueDream(dreamId);
		let opened: DreamView | null = null;

		if (dream !== null)
		{
			opened = structuredClone(dream);
			this.store.Open(opened, false);
			const navigation = this.NavigateToDreamSourceAsync(opened);
			void navigation;
		}

		return opened;
	}

	// Saves unsaved changes, then closes the active DreamView editing session.
	public async CloseAsync(): Promise<void>
	{
		this.CancelAutosave();
		if (this.store.GetIsDirty()) await this.SaveAsync();

		if (!this.store.GetIsDirty())
		{
			this.store.Close();
			const next = this.store.GetActiveDream();
			if (next === null) await this.events.PublishAsync("dream.closed", {});
			else
			{
				await this.NavigateToDreamSourceAsync(next);
				await this.events.PublishAsync("dream.opened", {});
			}
			await this.RefreshAsync();
		}
	}

	// Activates one open DreamView tab through the normal open workflow.
	public ActivateTab(dreamId: string): void
	{
		const dream = this.store.ActivateTab(dreamId);
		if (dream !== null)
		{
			const navigation = this.NavigateToDreamSourceAsync(dream);
			void navigation;
			void this.events.PublishAsync("dream.opened", {});
		}
	}

	// Activates and closes one DreamView tab, saving it first when necessary.
	public async CloseTabAsync(dreamId: string): Promise<void>
	{
		const activeId = this.store.GetActiveDream()?.id;
		let canClose = activeId === dreamId;
		if (!canClose)
		{
			const dream = this.store.ActivateTab(dreamId);
			canClose = dream !== null;
			if (dream !== null) await this.NavigateToDreamSourceAsync(dream);
		}
		if (canClose) await this.CloseAsync();
	}

	// Opens the owning text and moves the reader to the DreamView's source passage.
	private async NavigateToDreamSourceAsync(dream: DreamView): Promise<void>
	{
		if (this.library.GetText()?.id !== dream.workId)
		{
			await this.events.PublishAsync("library.text-open-requested", { textId: dream.workId });
		}
		await this.events.PublishAsync("library.jump-requested", { selection: dream.source });
	}

	// Deletes the active DreamView after any in-flight save completes.
	public async DeleteAsync(): Promise<boolean>
	{
		const dream = this.store.GetActiveDream();
		let deleted = false;

		if (dream !== null)
		{
			const dreamId = dream.id;
			this.isDeleting = true;
			this.CancelAutosave();
			this.store.Close();

			try
			{
				await this.WaitForActiveSaveAsync();
				await this.gateway.DeleteAsync(dreamId);
				await this.events.PublishAsync("dream.closed", {});
				await this.RefreshAsync();
				deleted = true;
			}
			catch (error)
			{
				this.errors.Report("DreamController", error, "Unable to delete the Dream.");
			}
			finally
			{
				this.isDeleting = false;
			}
		}

		return deleted;
	}

	// Waits for a save that is already writing to disk so a delete cannot race its write.
	private async WaitForActiveSaveAsync(): Promise<void>
	{
		const pendingSave = this.activeSave;

		if (pendingSave !== null)
		{
			await pendingSave;
			if (this.activeSave === pendingSave) this.activeSave = null;
		}
	}

	// Opens the unified Add to Idea workflow for one canonical Signal.
	public async AddSignalToIdeaAsync(signalId: string, ideaId?: string): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		const ownsSignal = dream !== null && this.HasSignal(dream, signalId);

		if (dream !== null && ownsSignal)
		{
			const event: ChoraEvents["idea.add-signal-requested"] = ideaId === undefined
				? { dreamId: dream.id, signalId }
				: { dreamId: dream.id, signalId, ideaId };
			await this.events.PublishAsync("idea.add-signal-requested", event);
		}
	}

	// Determines whether one DreamView owns the submitted Signal identity.
	private HasSignal(dream: DreamView, signalId: string): boolean
	{
		let ownsSignal = false;

		for (const signal of dream.signals)
		{
			if (signal.id === signalId)
			{
				ownsSignal = true;
			}
		}

		return ownsSignal;
	}

	// Updates the active DreamView title and schedules an autosave.
	public UpdateTitle(value: string): void
	{
		const change = this.store.UpdateTitle(value);
		this.HandleDreamChange(change);
	}

	// Updates the active DreamView reflections and schedules an autosave.
	public UpdateReflection(value: string): void
	{
		const change = this.store.UpdateReflection(value);
		this.HandleDreamChange(change);
	}

	public UpdateSynopticView(value: string): void
	{
		const change = this.store.UpdateSynopticView(value);
		this.HandleDreamChange(change);
	}

	public CanCreateSynopticView(dream: DreamView): boolean
	{
		return dream.reflection.trim().length > 0 || dream.signals.some((signal) => signal.description.trim().length > 0);
	}

	public IsCreatingSynopticView(dreamId: string): boolean
	{
		return this.creatingSynopticViewDreamIds.has(dreamId);
	}

	public async CreateSynopticViewAsync(): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		if (dream === null || this.creatingSynopticViewDreamIds.has(dream.id)) return;
		if (!this.CanCreateSynopticView(dream))
		{
			this.errors.Report("DreamController", new Error("The Dream has no reader-authored observations."), "Add a Signal observation or Reflection before checking clarity.");
			return;
		}

		const dreamId = dream.id;
		const revision = this.store.GetRevision();
		this.creatingSynopticViewDreamIds.add(dreamId);
		this.cancelledSynopticViewDreamIds.delete(dreamId);
		await this.events.PublishAsync("dream.synoptic-view-state-changed", { dreamId });
		try
		{
			const document = this.library.GetText();

			if (document === null || document.id !== dream.workId)
			{
				throw new Error("The Dream source document is not open.");
			}

			const snapshot = CreateDreamSnapshot(dream);
			const readingDocument = DreamMarkdownExport.SerializeForSynopticView(snapshot, dream.signals, document);
			const synopticView = await this.gateway.CreateSynopticViewAsync({ dreamId, readingDocument });
			const current = this.store.GetActiveDream();
			if (current?.id === dreamId && this.store.GetRevision() === revision)
			{
				const change = this.store.UpdateSynopticView(synopticView);
				this.HandleDreamChange(change);
			}
			else
			{
				this.errors.Report("DreamController", new Error("The Dream changed while its Clarity Check was being generated."), "The Clarity Check was not applied because the Dream changed.");
			}
		}
		catch (error)
		{
			if (!this.cancelledSynopticViewDreamIds.has(dreamId)) this.errors.Report("DreamController", error, "Unable to complete the Clarity Check.");
		}
		finally
		{
			this.creatingSynopticViewDreamIds.delete(dreamId);
			this.cancelledSynopticViewDreamIds.delete(dreamId);
			await this.events.PublishAsync("dream.synoptic-view-state-changed", { dreamId });
		}
	}

	public async CancelSynopticViewAsync(): Promise<void>
	{
		const dreamId = this.store.GetActiveDream()?.id;
		if (dreamId !== undefined && this.creatingSynopticViewDreamIds.has(dreamId))
		{
			this.cancelledSynopticViewDreamIds.add(dreamId);
			try
			{
				await this.gateway.CancelSynopticViewAsync(dreamId);
			}
			catch (error)
			{
				this.cancelledSynopticViewDreamIds.delete(dreamId);
				this.errors.Report("DreamController", error, "Unable to cancel the Clarity Check.");
			}
		}
	}

	public async CopySynopticViewAsync(): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		if (dream === null || dream.synopticView.trim().length === 0) throw new Error("There is no Clarity Check to copy.");
		await this.gateway.CopyAsync(dream.synopticView);
	}

	// Removes one signal from the active DreamView and schedules an autosave.
	public RemoveSignal(signalId: string): void
	{
		const dream = this.store.GetActiveDream();
		const signals = this.FilterOutSignal(dream, signalId);
		const change = dream === null ? null : this.store.ReplaceSignals(signals);

		this.HandleDreamChange(change);
		if (change !== null) void this.events.PublishAsync("dream.structure-changed", { dreamId: change.dream.id });
	}

	// Updates one signal's description and schedules an autosave.
	public UpdateSignal(signalId: string, value: string): void
	{
		const dream = this.store.GetActiveDream();
		const signal = dream?.signals.find((candidate) => candidate.id === signalId) ?? null;
		const change = this.store.UpdateSignalDescription(signalId, value);
		this.HandleDreamChange(change);

		if (dream !== null && signal !== null)
		{
			const saveAsync = this.gateway.SaveSignalDescriptionAsync.bind(this.gateway, signal, dream.workId, value);
			const applyAsync = this.ApplySavedSignalDescriptionAsync.bind(this);
			const report = this.ReportSignalDescriptionSaveError.bind(this);
			const persistence = this.signalDescriptionSaves.RequestAsync(signalId, value, saveAsync, applyAsync, report);
			void persistence;
		}
	}

	// Adds a signal for the given passage selection when it lies within the DreamView's source and is not a duplicate.
	public async AddSignal(selection: TextSelection): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		const document = this.library.GetText();

		if (dream === null)
		{
			this.errors.Report("DreamController", new Error("No active Dream."), "Open a Dream before adding a signal.");
		}

		else if (document === null || document.id !== dream.workId || !document.Contains(selection, dream.source))
		{
			this.errors.Report("DreamController", new Error("Selection outside the Dream's source passage."), "Select text within the Dream's passage to add a signal.");
		}
		else if (!IsValidSignalSelection(selection))
		{
			this.errors.Report(
				"DreamController",
				new Error("Signal selections must not be empty."),
				"Select text before creating a Signal.");
		}
		else if (!this.HasDuplicateSignal(dream.signals, selection))
		{
			const canonical = await this.gateway.CreateSignalAsync(selection);
			this.signals?.Replace(canonical);
			await this.AssociateSignalAsync(canonical);
		}

	}

	// Associates one work-owned Signal with the active DreamView.
	public async AssociateSignalAsync(signal: SignalRecord): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		const document = this.library.GetText();

		if (dream === null)
		{
			this.errors.Report("DreamController", new Error("No active Dream."), "Open a Dream before adding a Signal.");
		}
		else if (document === null
			|| signal.workId !== dream.workId
			|| !signal.selections.every((selection) => document.Contains(selection, dream.source)))
		{
			this.errors.Report("DreamController", new Error("Selection outside the Dream's source passage."), "Select text within the Dream's passage to add a Signal.");
		}
		else if (!dream.signals.some((candidate) => candidate.id === signal.id))
		{
			const associated = structuredClone(signal);
			const signals = [...dream.signals, associated];
			signals.sort(this.CompareSignalsBySelection.bind(this, document));
			const change = this.store.ReplaceSignals(signals);
			this.store.SetSelectedSignal(dream.id, associated.id);
			this.HandleDreamChange(change);

			if (change !== null)
			{
				const event = {
					dreamId: change.dream.id,
					signalId: associated.id
				};
				await this.events.PublishAsync("dream.signal-added", event);
			}
		}

		await Promise.resolve();
	}

	// Applies only the newest canonical Signal description returned by the serialized writer.
	private async ApplySavedSignalDescriptionAsync(saved: SignalRecord): Promise<void>
	{
		this.signals?.Replace(saved);
		await this.events.PublishAsync("signal.changed", { signal: saved });
	}

	// Reports canonical Signal persistence failure without replacing active local text.
	private ReportSignalDescriptionSaveError(error: unknown): void
	{
		this.errors.Report("DreamController", error, "Unable to save this Signal.");
	}

	// Refreshes DreamView projections after a canonical Signal changes elsewhere.
	private async HandleSignalChangedAsync(event: ChoraEvents["signal.changed"]): Promise<void>
	{
		const dreamId = this.store.ApplySignal(event.signal);

		if (dreamId !== null)
		{
			await this.events.PublishAsync("dream.structure-changed", { dreamId });
		}
	}

	// Removes a globally deleted Signal from every renderer Dream projection.
	private async HandleSignalDeletedAsync(event: ChoraEvents["signal.deleted"]): Promise<void>
	{
		const dreamIds = this.store.RemoveSignalEverywhere(event.signalId);

		for (const dreamId of dreamIds)
		{
			await this.events.PublishAsync("dream.structure-changed", { dreamId });
		}
	}

	// Extends the active DreamView's source passage to include the given selection.
	public async ExtendSourceAsync(selection: TextSelection): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		const document = this.library.GetText();

		if (dream === null)
		{
			this.errors.Report("DreamController", new Error("No active Dream."), "Open a Dream before extending its source passage.");
		}
		else if (document === null || selection.documentId !== dream.workId || document.id !== dream.workId)
		{
			this.errors.Report("DreamController", new Error("Selection outside the Dream's text."), "Select text in the Dream's own text to extend its passage.");
		}
		else if (!document.AreSelectionsAdjacent(selection, dream.source))
		{
			this.errors.Report("DreamController", new Error("Selection is not adjacent to the Dream source."), "Select text immediately before or after the Dream source.");
		}
		else
		{
			const source = document.MergeSelections(dream.source, selection);
			const change = this.store.ReplaceSource(source);

			this.HandleDreamChange(change);
			if (change !== null)
			{
				await this.events.PublishAsync("dream.structure-changed", { dreamId: change.dream.id });
				await this.events.PublishAsync("library.jump-requested", { selection: change.dream.source, target: "source" });
			}
		}
	}

	// Saves the active DreamView, then saves once more if a concurrent edit left it dirty, then reschedules autosave.
	public async SaveAsync(): Promise<void>
	{
		this.CancelAutosave();
		await this.RunPendingSaveAsync();
		await this.RunCatchUpSaveIfDirtyAsync();

		if (this.store.GetIsDirty() && this.store.GetSaveState() !== "error") this.ScheduleAutosave();
	}

	public async CopyDreamAsMarkdownAsync(): Promise<void>
	{
		const dream = this.store.GetActiveDream();

		if (dream === null)
		{
			throw new Error("The active Dream is no longer available.");
		}
		else
		{
			const document = this.library.GetText();

			if (document === null || document.id !== dream.workId)
			{
				throw new Error("The Dream source document is not open.");
			}

			const snapshot = CreateDreamSnapshot(dream);
			const markdown = DreamMarkdownExport.Serialize(snapshot, dream.signals, document);
			await this.gateway.CopyAsync(markdown);
		}
	}

	// Returns the reader's visible DreamView catalogue, grouped by division when division data is available.
	public GetCatalogueGroups(searchText: string): DreamCatalogueGroup[]
	{
		const document = this.library.GetText();
		const dreams = this.store.GetVisibleCatalogue(searchText, document);
		const divisions = this.FindDivisions(dreams);
		const hasDivisions = this.HasAnyDivision(divisions);
		let groups: DreamCatalogueGroup[] = [];

		if (dreams.length > 0) groups = hasDivisions ? this.GroupByDivision(dreams, divisions) : [{ label: "", book: null, dreams }];

		return groups;
	}

	// Shows the source-passage context menu and performs the reader's chosen action.
	public async HandleTextSelectionAsync(selection: TextSelection): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		const selectedSignalId = dream === null ? null : this.store.GetSelectedSignal(dream.id);
		const selectedSignal = selectedSignalId === null
			? null
			: this.signals?.GetSignal(selectedSignalId)
				?? dream?.signals.find((candidate) => candidate.id === selectedSignalId)
				?? null;
		const document = this.library.GetText();
		const canAddToSelectedSignal = selectedSignal !== null
			&& document !== null
			&& selectedSignal.workId === selection.documentId
			&& !selectedSignal.selections.some((candidate) => document.Contains(selection, candidate));
		const action = await this.gateway.ShowSourceContextMenuAsync(canAddToSelectedSignal);
		if (action === "add-dream-source-signal") await this.events.PublishAsync("dream.signal-add-requested", { selection });
		if (action === "add-to-selected-signal" && selectedSignal !== null && canAddToSelectedSignal)
		{
			await this.events.PublishAsync("signal.selection-add-requested", { signalId: selectedSignal.id, selection });
		}
		const selectedText = document?.id === selection.documentId
			? document.ReconstructText(selection)
			: "";
		if (action === "copy-dream-source") await this.gateway.CopyAsync(selectedText);
		if (action === "lookup") await this.gateway.LookUpAsync(selectedText);
	}

	// Builds a document selection from a source-passage offset range, reporting rather than throwing when it is invalid.
	public CreateTextSelection(document: TextDocument, source: TextSelection, startOffset: number, endOffset: number): TextSelection | null
	{
		let selection: TextSelection | null = null;

		try
		{
			selection = CreateDreamTextSelection(document, source, startOffset, endOffset);
		}
		catch (error)
		{
			this.errors.Report("DreamController", error, "Unable to read the selected text.");
		}

		return selection;
	}

	// Resolves exact source text from the currently open canonical document.
	public ResolveSelectionText(selection: TextSelection): string
	{
		const document = this.library.GetText();
		const text = document?.id === selection.documentId
			? document.ReconstructText(selection)
			: "";

		return text;
	}

	// Formats the citations covering an exact source selection.
	public FormatSelectionRange(selection: TextSelection): string
	{
		const document = this.library.GetText();
		const start = document?.id === selection.documentId
			? document.ResolveCitation(selection.start)?.value
			: undefined;
		const end = document?.id === selection.documentId
			? document.ResolveCitation(selection.end)?.value
			: undefined;
		let range = start ?? end ?? "source";

		if (start !== undefined && end !== undefined && start !== end)
		{
			range = `${start}–${end}`;
		}

		return range;
	}

	// Coordinates events and autosave after a store-owned DreamView mutation.
	private HandleDreamChange(change: DreamChange | null): void
	{
		if (change !== null)
		{
			if (change.becameDirty)
			{
				void this.events.PublishAsync("dream.changed", {});
			}
			this.ScheduleAutosave();
		}
	}

	private async PerformSaveAsync(): Promise<void>
	{
		const activeDream = this.store.GetActiveDream();

		if (activeDream !== null && !this.isDeleting)
		{
			const revision = this.store.GetRevision();
			const dream = structuredClone(activeDream);
			dream.updatedAt = new Date().toISOString();
			this.SetSaveState("saving");

			try
			{
				const snapshot = CreateDreamSnapshot(dream);
				const savedSnapshot = await this.gateway.SaveAsync(snapshot);
				const savedDream = this.CreateView(savedSnapshot, dream.signals);
				const snapshots = await this.gateway.ListAsync();
				const catalogue = this.CreateViews(snapshots);
				this.store.SetCatalogue(catalogue);
				this.store.MarkSaved(savedDream, revision);
				await this.events.PublishAsync("dream.saved", {});
			}

			catch (error)
			{
				this.SetSaveState("error");
				const message = error instanceof Error ? error.message : String(error);
				this.errors.Error("DreamController", message, error);
			}
		}
	}

	// Resolves canonical Signals into the renderer-only Dream projection.
	private CreateView(snapshot: DreamSnapshot, fallbackSignals: readonly SignalRecord[] = []): DreamView
	{
		const signals = this.signals?.GetSignals() ?? fallbackSignals;
		const view = CreateDreamView(snapshot, signals);

		return view;
	}

	// Resolves a collection of serialized Dreams for renderer display.
	private CreateViews(snapshots: readonly DreamSnapshot[]): DreamView[]
	{
		const views: DreamView[] = [];

		for (const snapshot of snapshots)
		{
			const view = this.CreateView(snapshot);
			views.push(view);
		}

		return views;
	}

	// Starts an immediate save when none is already in flight, otherwise waits for the one already running.
	private async RunPendingSaveAsync(): Promise<void>
	{
		if (this.activeSave === null)
		{
			this.activeSave = this.PerformSaveAsync();
			await this.activeSave;
			this.activeSave = null;
		}
		else
		{
			await this.activeSave;
		}
	}

	// Saves once more when a concurrent edit left the DreamView dirty after the pending save completed.
	private async RunCatchUpSaveIfDirtyAsync(): Promise<void>
	{
		if (this.store.GetIsDirty() && this.store.GetSaveState() !== "error" && this.activeSave === null)
		{
			this.activeSave = this.PerformSaveAsync();
			await this.activeSave;
			this.activeSave = null;
		}
	}

	private ScheduleAutosave(): void
	{
		this.CancelAutosave();
		this.autosaveTimer = setTimeout(this.HandleAutosaveTimer.bind(this), DreamController.AutosaveDelayMilliseconds);
	}

	// Clears the pending autosave timer and starts the deferred save.
	private HandleAutosaveTimer(): void
	{
		this.autosaveTimer = null;
		void this.SaveAsync();
	}

	// Cancels a pending autosave timer, if one is scheduled.
	private CancelAutosave(): void
	{
		if (this.autosaveTimer !== null)
		{
			clearTimeout(this.autosaveTimer);
			this.autosaveTimer = null;
		}
	}

	// Records and publishes a change to the active DreamView's save-state lifecycle.
	private SetSaveState(state: DreamSaveState): void
	{
		this.store.SetSaveState(state);
		void this.events.PublishAsync("dream.save-state-changed", {});
	}

	// Routes a create-requested application event to the DreamView creation workflow.
	private async HandleCreateRequested(event: ChoraEvents["dream.create-requested"]): Promise<void>
	{
		await this.Create(event.selection);
	}

	// Routes a signal-add-requested application event to the signal workflow.
	private async HandleSignalAddRequested(event: ChoraEvents["dream.signal-add-requested"]): Promise<void>
	{
		await this.AddSignal(event.selection);
	}

	// Routes a source-extend-requested application event to the source-extension workflow.
	private async HandleSourceExtendRequestedAsync(event: ChoraEvents["dream.source-extend-requested"]): Promise<void>
	{
		await this.ExtendSourceAsync(event.selection);
	}

	// Finds a DreamView in the catalogue by identity, or null when it is not present.
	private FindCatalogueDream(dreamId: string): DreamView | null
	{
		let found: DreamView | null = null;

		for (const dream of this.store.GetCatalogue())
		{
			if (dream.id === dreamId)
			{
				found = dream;
				break;
			}
		}

		return found;
	}

	// Finds the division of each DreamView, in the same order, using its recorded division or a document lookup.
	private FindDivisions(dreams: readonly DreamView[]): (DreamDivision | null)[]
	{
		const divisions: (DreamDivision | null)[] = [];

		for (const dream of dreams) divisions.push(this.FindDivision(dream));

		return divisions;
	}

	// Returns whether any division in the given list is present.
	private HasAnyDivision(divisions: readonly (DreamDivision | null)[]): boolean
	{
		let hasDivision = false;

		for (const division of divisions)
		{
			if (division !== null)
			{
				hasDivision = true;
				break;
			}
		}

		return hasDivision;
	}

	// Returns a DreamView's recorded division, falling back to a lookup in its currently open source document.
	private FindDivision(dream: DreamView): DreamDivision | null
	{
		let division: DreamDivision | null = null;
		const document = this.library.GetText();

		if (division === null && document?.id === dream.workId) division = this.FindSegmentDivision(document, dream);

		return division;
	}

	// Finds the division of the source segment matching a DreamView's start segment key, falling back to its locator.
	private FindSegmentDivision(document: TextDocument, dream: DreamView): DreamDivision | null
	{
		let division: DreamDivision | null = null;

		for (const segment of document.segments)
		{
			if (segment.key === dream.source.start.segmentKey)
			{
				division = segment.division ?? null;
				break;
			}
		}

		return division;
	}

	// Groups Dreams by owning work and division, preserving each group's first-seen order.
	private GroupByDivision(dreams: readonly DreamView[], divisions: readonly (DreamDivision | null)[]): DreamCatalogueGroup[]
	{
		const groups = new Map<string, { label: string; book: string | null; dreams: DreamView[] }>();

		for (let index = 0; index < dreams.length; index += 1)
		{
			const dream = dreams[index];
			const division = divisions[index] ?? null;

			if (dream !== undefined)
			{
				const key = division === null ? `${dream.workId}:unplaced` : `${dream.workId}:${division.type}:${division.label}`;
				let group = groups.get(key);

				if (group === undefined)
				{
					const label = division === null ? "Unplaced" : this.FormatDivisionLabel(division.type, division.label);
					const book = division?.type === "book" ? division.label : null;
					group = { label, book, dreams: [] };
					groups.set(key, group);
				}

				group.dreams.push(dream);
			}
		}

		const result: DreamCatalogueGroup[] = [];

		for (const group of groups.values()) result.push(group);

		return result;
	}

	// Formats a division as a reader-facing heading (e.g. "Book 4").
	private FormatDivisionLabel(kind: string, value: string): string
	{
		const kindLabel = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
		const label = `${kindLabel} ${value}`;

		return label;
	}

	// Returns the given DreamView's signals with the identified signal removed.
	private FilterOutSignal(dream: DreamView | null, signalId: string): SignalRecord[]
	{
		const signals: SignalRecord[] = [];

		for (const signal of dream?.signals ?? [])
		{
			if (signal.id !== signalId) signals.push(signal);
		}

		return signals;
	}

	// Returns whether a signal already exists for the same start and end selection points.
	private HasDuplicateSignal(signals: readonly SignalRecord[], selection: TextSelection): boolean
	{
		let isDuplicate = false;

		for (const signal of signals)
		{
			if (HasSignalSelection(signal, selection))
			{
				isDuplicate = true;
				break;
			}
		}

		return isDuplicate;
	}

	// Orders two signals by their position within the source document.
	private CompareSignalsBySelection(document: TextDocument, first: SignalRecord, second: SignalRecord): number
	{
		const comparison = document.CompareSelections(GetSignalAnchor(first), GetSignalAnchor(second));

		return comparison;
	}

}

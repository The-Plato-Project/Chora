import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { TextDocument, LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { LibraryGateway } from "./LibraryGateway.js";
import { LibraryStore } from "./LibraryStore.js";

// Coordinates Library workflows between the catalogue, the active text, and the main process.
export class LibraryController
{
	// Local storage key for the reader's last-opened work.
	private static readonly LastWorkKey = "chora:last-work";
	private activeDocumentKind: "dream" | "idea" | null = null;
	private activeSignalId: string | null = null;
	private activeSignalSelections: readonly TextSelection[] = [];

	// Creates the controller and subscribes to the application events it coordinates.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly store: LibraryStore,
		private readonly gateway: LibraryGateway,
		private readonly getActiveDreamSource: () => TextSelection | null = function NoActiveDreamSource(): null { return null; })
	{
		this.events.Subscribe("library.text-open-requested", this.HandleTextOpenRequested.bind(this));
		this.events.Subscribe("workspace.document-selected", this.HandleDocumentSelected.bind(this));
		this.events.Subscribe("signal.active-changed", this.HandleActiveSignalChanged.bind(this));
	}

	// Loads the Library catalogue and opens the reader's preferred work.
	public async StartAsync(): Promise<void>
	{
		try
		{
			const texts = await this.gateway.ListAsync();
			this.store.SetLibrary(texts);
			const preferredId = this.ResolvePreferredWorkId(texts);
			if (preferredId !== null) await this.OpenAsync(preferredId);
		}
		catch (error)
		{
			this.errors.Report("LibraryController", error, "Unable to load the Library.");
		}
	}

	// Opens the remembered or default Library text so the reader can select a Dream source.
	public async OpenPreferredAsync(): Promise<void>
	{
		const texts = this.store.GetSnapshot().texts;
		const preferredId = this.ResolvePreferredWorkId(texts);

		if (preferredId !== null) await this.OpenAsync(preferredId);
		else this.errors.Report("LibraryController", new Error("The Library is empty."), "No texts are available.");
	}

	// Opens a work by id and publishes it as the active text.
	public async OpenAsync(textId: string): Promise<void>
	{
		try
		{
			const text = await this.gateway.LoadAsync(textId);
			const notice = await this.gateway.GetSourceNoticeAsync(textId);
			this.store.Open(text, notice);
			this.SaveLastWorkId(textId);
			this.SetFocusSegment(text.segments[0]?.key ?? "");
			await this.events.PublishAsync("library.text-opened", {});
		}
		catch (error)
		{
			this.errors.Report("LibraryController", error, "Unable to open the text.");
		}
	}

	// Opens a text supplied directly by the main process, bypassing the Library catalogue lookup.
	public OpenExternal(text: TextDocument): void
	{
		this.store.Open(text, null);
		this.SetFocusSegment(text.segments[0]?.key ?? "");
		void this.events.PublishAsync("library.text-opened", {});
	}

	// Reconciles a raw browser selection into canonical form and publishes it when changed.
	public SetSelection(selection: TextSelection | null): void
	{
		const snapshot = this.store.GetSnapshot();
		const previous = snapshot.selection;
		let canonical: TextSelection | null = null;
		if (snapshot.text !== null && selection !== null)
		{
			try
			{
				snapshot.text.ValidateSelection(selection);
				canonical = snapshot.text.CreateSelection(selection.start, selection.end);
			}
			catch (error)
			{
				this.errors.Debug("LibraryController", "Ignored an invalid browser selection.", error);
			}
		}
		if (!this.AreSelectionsEqual(previous, canonical))
		{
			this.store.SetSelection(canonical);
			void this.events.PublishAsync("library.selection-changed", {});
		}
	}

	// Sets the focus segment used as a selection fallback for Dream creation.
	public SetFocusSegment(segmentKey: string): void
	{
		const text = this.store.GetSnapshot().text;
		const segment = text?.segments.find((item) => item.key === segmentKey);
		if (text !== null && text !== undefined && segment !== undefined)
		{
			const focus = text.CreateSelection(
				{ segmentKey, offset: 0 },
				{ segmentKey, offset: segment.text.length });
			this.store.SetFocus(focus);
			void this.events.PublishAsync("library.focus-changed", { textId: text.id, segmentKey });
		}
	}

	// Shows the selection context menu and routes the reader's choice to its workflow.
	public async HandleSelectionActionAsync(selection: TextSelection): Promise<void>
	{
		const document = this.store.GetText();
		const activeDreamSource = this.activeDocumentKind === "dream" ? this.getActiveDreamSource() : null;
		const canAddToDreamSource = document !== null
			&& activeDreamSource !== null
			&& selection.documentId === activeDreamSource.documentId
			&& document.AreSelectionsAdjacent(selection, activeDreamSource);
		const canAddSignal = this.activeDocumentKind === "idea"
			|| (this.activeDocumentKind === "dream"
				&& document !== null
				&& activeDreamSource !== null
				&& document.Contains(selection, activeDreamSource));
		const canAddToSelectedSignal = this.activeSignalId !== null
			&& document !== null
			&& canAddSignal
			&& this.activeSignalSelections.some((candidate) => candidate.documentId === selection.documentId)
			&& !this.activeSignalSelections.some((candidate) => document.Contains(selection, candidate));
		const action = await this.gateway.ShowSelectionContextMenuAsync(canAddSignal, canAddToDreamSource, canAddToSelectedSignal);
		if (action === "create-dream") await this.events.PublishAsync("dream.create-requested", { selection });
		if (action === "add-to-dream" && canAddToDreamSource) await this.events.PublishAsync("dream.source-extend-requested", { selection });
		if (action === "add-signal" && canAddSignal) await this.events.PublishAsync("signal.add-requested", { selection });
		if (action === "add-to-selected-signal" && this.activeSignalId !== null && canAddToSelectedSignal)
		{
			await this.events.PublishAsync("signal.selection-add-requested", { signalId: this.activeSignalId, selection });
		}
		const selectedText = document?.id === selection.documentId
			? document.ReconstructText(selection)
			: "";
		if (action === "copy") await this.gateway.CopyAsync(selectedText);
		if (action === "lookup") await this.gateway.LookUpAsync(selectedText);
	}

	// Tracks which document may receive the generic Add Signal action.
	private HandleDocumentSelected(event: ChoraEvents["workspace.document-selected"]): void
	{
		this.activeDocumentKind = event.kind;
		if (event.kind === null)
		{
			this.activeSignalId = null;
			this.activeSignalSelections = [];
		}
	}

	// Tracks the selected Signal that may receive another exact component.
	private HandleActiveSignalChanged(event: ChoraEvents["signal.active-changed"]): void
	{
		this.activeSignalId = event.signalId;
		this.activeSignalSelections = structuredClone(event.selections);
	}

	// Routes a text-open-requested application event to the open workflow.
	private async HandleTextOpenRequested(event: ChoraEvents["library.text-open-requested"]): Promise<void>
	{
		await this.OpenAsync(event.textId);
	}

	// Prefers the last-opened work, then Republic, then the first available work.
	private ResolvePreferredWorkId(texts: readonly LibraryTextSummary[]): string | null
	{
		const savedId = this.LoadLastWorkId();
		let preferred: string | null = null;

		if (savedId !== null && texts.some((text) => text.id === savedId)) preferred = savedId;
		else if (texts.some((text) => text.id === "republic")) preferred = "republic";
		else preferred = texts[0]?.id ?? null;

		return preferred;
	}

	// Reads the last-opened work id from persistent storage, tolerating unavailable storage.
	private LoadLastWorkId(): string | null
	{
		let workId: string | null = null;

		try
		{
			workId = window.localStorage.getItem(LibraryController.LastWorkKey);
		}
		catch
		{
			workId = null;
		}

		return workId;
	}

	// Remembers the opened work id for the next application run, tolerating unavailable storage.
	private SaveLastWorkId(textId: string): void
	{
		try
		{
			window.localStorage.setItem(LibraryController.LastWorkKey, textId);
		}
		catch
		{
			// The last-opened work is remembered only when storage is available.
		}
	}

	// Returns whether two selections refer to the same span.
	private AreSelectionsEqual(first: TextSelection | null, second: TextSelection | null): boolean
	{
		let isEqual = first === null && second === null;
		if (first !== null && second !== null)
		{
			isEqual = first.documentId === second.documentId
				&& first.start.segmentKey === second.start.segmentKey
				&& first.start.offset === second.start.offset
				&& first.end.segmentKey === second.end.segmentKey
				&& first.end.offset === second.end.offset;
		}
		return isEqual;
	}
}

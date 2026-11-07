import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents, ReaderHighlightKind } from "../core/events/ChoraEvents.js";
import { LibraryGateway } from "./LibraryGateway.js";
import { LibraryStore } from "./LibraryStore.js";
import type { DreamView } from "../dreams/DreamView.js";

// Read-only Dream state required to evaluate reader selection actions.
export interface LibraryDreamContext
{
	// Returns the active Dream editing snapshot.
	GetActiveDream(): DreamView | null;
	// Returns the Signal selected in one Dream editing session.
	GetSelectedSignal(dreamId: string): string | null;
}

// Coordinates Library workflows between the catalogue, the active text, and the main process.
export class LibraryController
{
	// Local storage key for the reader's last-opened work.
	private static readonly LastWorkKey = "chora:last-work";

	// Creates the controller and subscribes to the application events it coordinates.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly store: LibraryStore,
		private readonly gateway: LibraryGateway,
		private readonly dreams: LibraryDreamContext)
	{
		this.events.Subscribe("library.text-open-requested", this.HandleTextOpenRequested.bind(this));
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
				{ stephanus: segmentKey, offset: 0 },
				{ stephanus: segmentKey, offset: segment.text.length });
			this.store.SetFocus(focus);
			void this.events.PublishAsync("library.focus-changed", { textId: text.id, segmentKey });
		}
	}

	// Public reader API for revealing and highlighting one exact canonical text selection.
	public async RevealSelectionAsync(selection: TextSelection, highlight: ReaderHighlightKind): Promise<void>
	{
		const document = this.store.GetText();
		if (document === null || document.id !== selection.dialogue)
		{
			this.errors.Report(
				"LibraryController",
				new Error("The requested selection belongs to a text that is not open."),
				"Open the selection's text before navigating.");
			return;
		}
		try
		{
			document.ValidateSelection(selection);
		}
		catch (error)
		{
			this.errors.Report("LibraryController", error, "The requested text location is invalid.");
			return;
		}
		await this.events.PublishAsync("library.jump-requested", { selection, target: highlight });
	}

	// Shows the selection context menu and routes the reader's choice to its workflow.
	public async HandleSelectionActionAsync(selection: TextSelection): Promise<void>
	{
		const document = this.store.GetText();
		const activeDream = this.dreams.GetActiveDream();
		const activeDreamSource = activeDream?.source ?? null;
		const activeSignalId = activeDream === null ? null : this.dreams.GetSelectedSignal(activeDream.id);
		const activeSignal = activeSignalId === null
			? null
			: activeDream?.signals.find(function MatchesSignal(signal): boolean
			{
				return signal.id === activeSignalId;
			}) ?? null;
		const canAddToDreamSource = document !== null
			&& activeDreamSource !== null
			&& selection.dialogue === activeDreamSource.dialogue
			&& document.AreSelectionsAdjacent(selection, activeDreamSource);
		const canAddSignal = activeDream !== null
			&& document !== null
			&& activeDreamSource !== null
			&& document.Contains(selection, activeDreamSource);
		const canAddToSelectedSignal = activeSignal !== null
			&& document !== null
			&& activeSignal.selections.some((candidate) => candidate.dialogue === selection.dialogue)
			&& !activeSignal.selections.some((candidate) => document.Contains(selection, candidate));
		const selectedText = document?.id === selection.dialogue
			? document.ReconstructText(selection)
			: "";
		const wordSelection = document?.id === selection.dialogue
			? document.GetSingleGreekWordSelection(selection)
			: null;
		const canExploreWord = wordSelection !== null;
		const action = await this.gateway.ShowSelectionContextMenuAsync(canAddSignal, canAddToDreamSource, canAddToSelectedSignal, canExploreWord);
		if (action === "explore-word" && wordSelection !== null)
		{
			this.SetSelection(null);
			await this.events.PublishAsync("word.exploration-requested", { selection: wordSelection });
		}
		if (action === "create-dream") await this.events.PublishAsync("dream.create-requested", { selection });
		if (action === "add-to-dream" && canAddToDreamSource) await this.events.PublishAsync("dream.source-extend-requested", { selection });
		if (action === "add-signal" && canAddSignal) await this.events.PublishAsync("dream.signal-add-requested", { selection });
		if (action === "add-to-selected-signal" && activeSignalId !== null && canAddToSelectedSignal)
		{
			await this.events.PublishAsync("signal.selection-add-requested", { signalId: activeSignalId, selection });
		}
		if (action === "copy") await this.gateway.CopyAsync(selectedText);
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
			isEqual = first.dialogue === second.dialogue
				&& first.text_version === second.text_version
				&& first.start.stephanus === second.start.stephanus
				&& first.start.offset === second.start.offset
				&& first.end.stephanus === second.end.stephanus
				&& first.end.offset === second.end.offset;
		}
		return isEqual;
	}
}

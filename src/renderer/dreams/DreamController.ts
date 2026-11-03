import type { DreamView } from "./DreamView.js";
import type { TextDocument } from "../../shared/library/LibraryTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { CreateDreamTextSelection } from "./DreamTextSelection.js";
import { DreamGateway } from "./DreamGateway.js";
import { DreamStore, type DreamTab } from "./DreamStore.js";
import { LibraryGateway } from "../library/LibraryGateway.js";

import type { Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { DreamSaveCoordinator } from "./DreamSaveCoordinator.js";

// Owns Dream editing commands, source extension, and editor-tab lifecycle.
export class DreamController
{
	// Editing-event subscriptions released with this controller.
	private readonly subscriptions: Unsubscribe[] = [];

	// Coordinates editing with the separately owned persistence workflow.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager, private readonly library: LibraryStore, private readonly store: DreamStore, private readonly gateway: DreamGateway, private readonly reader: LibraryGateway, private readonly saves: DreamSaveCoordinator)
	{
		this.subscriptions.push(events.Subscribe("dream.source-extend-requested", this.HandleSourceExtendRequestedAsync.bind(this)));
	}

	// Reopens the editor session after the catalogue owner has completed its initial load.
	public async StartAsync(): Promise<void>
	{
		try
		{
			const activeDream = this.store.GetActiveDream();

			if (activeDream !== null)
			{
				await this.events.PublishAsync("dream.opened", {});
				if (this.store.GetIsDirty()) this.saves.ScheduleAutosave();
			}
		}
		catch (error)
		{
			const message = "Unable to load Dreams";
			this.errors.Report("DreamController", error, message);
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

	// Handles an explicit request to jump to one Signal associated with the active DreamView.
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
		}

		return opened;
	}

	// Saves unsaved changes, then closes the active DreamView editing session.
	public async CloseAsync(): Promise<void>
	{
		this.saves.CancelAutosave();
		await this.saves.WaitForIdleAsync();
		if (this.store.GetIsDirty()) await this.saves.SaveAsync();

		if (!this.store.GetIsDirty())
		{
			this.store.Close();
			const next = this.store.GetActiveDream();
			if (next === null)
			{
				await this.events.PublishAsync("dream.closed", {});
			}
			else
			{
				await this.events.PublishAsync("dream.opened", {});
			}
		}
	}

	// Activates one open DreamView tab through the normal open workflow.
	public ActivateTab(dreamId: string): void
	{
		const dream = this.store.ActivateTab(dreamId);
		if (dream !== null)
		{
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
		}
		if (canClose) await this.CloseAsync();
	}

	// Deletes the active DreamView after any in-flight save completes.
	public async DeleteAsync(): Promise<boolean>
	{
		const dream = this.store.GetActiveDream();
		let deleted = false;

		if (dream !== null)
		{
			const dreamId = dream.id;
			let resume: (() => void) | null = null;

			try
			{
				resume = await this.saves.SuspendAsync(dreamId);
				await this.gateway.DeleteAsync(dreamId);
				this.store.Remove(dreamId);
				const next = this.store.GetActiveDream();
				await this.events.PublishAsync("dream.catalogue-changed", { count: this.store.GetCatalogue().length });

				if (next === null) await this.events.PublishAsync("dream.closed", {});
				else await this.events.PublishAsync("dream.opened", {});
				deleted = true;
			}
			catch (error)
			{
				this.errors.Report("DreamController", error, "Unable to delete the Dream.");
			}
			finally
			{
				resume?.();
			}
		}

		return deleted;
	}

	// Updates the active DreamView title and schedules an autosave.
	public UpdateTitle(value: string): void
	{
		const change = this.store.UpdateTitle(value);
		this.saves.HandleDreamChange(change);
	}

	// Updates the active DreamView reflections and schedules an autosave.
	public UpdateReflection(value: string): void
	{
		const change = this.store.UpdateReflection(value);
		this.saves.HandleDreamChange(change);
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
		else if (document === null || selection.dialogue !== dream.workId || document.id !== dream.workId)
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

			this.saves.HandleDreamChange(change);
			if (change !== null)
			{
				await this.events.PublishAsync("dream.structure-changed", { dreamId: change.dream.id });
			}
		}
	}

	// Shows the source-passage context menu and performs the reader's chosen action.
	public async HandleTextSelectionAsync(selection: TextSelection): Promise<void>
	{
		const dream = this.store.GetActiveDream();
		const selectedSignalId = dream === null ? null : this.store.GetSelectedSignal(dream.id);
		const selectedSignal = selectedSignalId === null
			? null
			: dream?.signals.find((candidate) => candidate.id === selectedSignalId)
				?? null;
		const document = this.library.GetText();
		const canAddToSelectedSignal = selectedSignal !== null
			&& document !== null
			&& selectedSignal.workId === selection.dialogue
			&& !selectedSignal.selections.some((candidate) => document.Contains(selection, candidate));
		const selectedText = document?.id === selection.dialogue
			? document.ReconstructText(selection)
			: "";
		const wordSelection = document?.id === selection.dialogue
			? document.GetSingleGreekWordSelection(selection)
			: null;
		const canExploreWord = wordSelection !== null;
		const action = await this.gateway.ShowSourceContextMenuAsync(canAddToSelectedSignal, canExploreWord);
		if (action === "explore-word" && wordSelection !== null)
		{
			await this.events.PublishAsync("word.exploration-requested", { selection: wordSelection });
		}
		if (action === "add-dream-source-signal") await this.events.PublishAsync("dream.signal-add-requested", { selection });
		if (action === "add-to-selected-signal" && selectedSignal !== null && canAddToSelectedSignal)
		{
			await this.events.PublishAsync("signal.selection-add-requested", { signalId: selectedSignal.id, selection });
		}
		if (action === "copy-dream-source") await this.reader.CopyAsync(selectedText);
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
		const text = document?.id === selection.dialogue
			? document.ReconstructText(selection)
			: "";

		return text;
	}

	// Formats the citations covering an exact source selection.
	public FormatSelectionRange(selection: TextSelection): string
	{
		const document = this.library.GetText();
		const start = document?.id === selection.dialogue
			? document.ResolveCitation(selection.start)?.value
			: undefined;
		const end = document?.id === selection.dialogue
			? document.ResolveCitation(selection.end)?.value
			: undefined;
		let range = start ?? end ?? "source";

		if (start !== undefined && end !== undefined && start !== end)
		{
			range = `${start}–${end}`;
		}

		return range;
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

	// Releases editing-event subscriptions; save and request owners have their own lifetimes.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
	}
}

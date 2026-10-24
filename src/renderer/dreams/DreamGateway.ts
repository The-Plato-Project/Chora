import type { DreamView } from "./DreamView.js";
import type { DreamSnapshot, DreamSynopticViewRequest } from "../../shared/dreams/DreamTypes.js";
import type { SelectionAction } from "../../shared/text/TextSelection.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";

// Stateless IPC client for the DreamView use cases exposed by the main process.
export class DreamGateway
{
	// Lists all Dreams visible to the reader.
	public ListAsync(): Promise<DreamSnapshot[]>
	{
		return window.chora.ListDreams();
	}

	// Saves one DreamView record through the main-process DreamView service.
	public SaveAsync(dream: DreamSnapshot): Promise<DreamSnapshot>
	{
		return window.chora.SaveDream(dream);
	}

	// Deletes one DreamView record through the main-process DreamView service.
	public DeleteAsync(dreamId: string): Promise<void>
	{
		return window.chora.DeleteDream(dreamId);
	}

	// Shows the native context menu for a DreamView source-passage selection.
	public ShowSourceContextMenuAsync(canAddToSelectedSignal: boolean): Promise<SelectionAction>
	{
		return window.chora.ShowDreamSourceContextMenu(canAddToSelectedSignal);
	}

	// Copies the given text to the operating system clipboard.
	public CopyAsync(text: string): Promise<void>
	{
		return window.chora.CopySelectedText(text);
	}

	// Looks up selected source text using the reader's configured dictionary.
	public LookUpAsync(text: string): Promise<void>
	{
		return window.chora.LookUpWord(text);
	}

	// Allocates a new canonical identifier for a DreamView or DreamView signal from the main process.
	public AllocateIdAsync(): Promise<string>
	{
		return window.chora.AllocateDreamId();
	}

	// Creates one canonical work-owned Signal.
	public CreateSignalAsync(selection: TextSelection): Promise<SignalRecord>
	{
		return window.chora.SaveSignal({
			signalId: null,
			workId: selection.documentId,
			selections: [selection],
			description: ""
		});
	}

	// Persists one canonical Signal description.
	public SaveSignalDescriptionAsync(signal: DreamView["signals"][number], workId: string, description: string): Promise<SignalRecord>
	{
		return window.chora.SaveSignal({
			signalId: signal.id,
			workId,
			selections: signal.selections,
			description
		});
	}

	public CreateSynopticViewAsync(request: DreamSynopticViewRequest): Promise<string>
	{
		return window.chora.CreateDreamSynopticView(request);
	}

	public CancelSynopticViewAsync(dreamId: string): Promise<void>
	{
		return window.chora.CancelDreamSynopticView(dreamId);
	}
}

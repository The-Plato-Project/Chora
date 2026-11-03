import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import { TextDocument, type LibraryTextSummary, type SourceNotice } from "../../shared/library/LibraryTypes.js";
import type { SelectionAction } from "../../shared/text/TextSelection.js";
import type { ApiSubscription } from "../../shared/contracts/ChoraApi.js";

// Stateless IPC client for the Library use cases exposed by the main process.
export class LibraryGateway
{
	// Lists all texts available in the Library catalogue.
	public ListAsync(): Promise<LibraryTextSummary[]>
	{
		return ReadOperationAsync(window.chora.ListLibraryTexts());
	}

	// Loads one text by id for reading.
	public async LoadAsync(textId: string): Promise<TextDocument>
	{
		const snapshot = await ReadOperationAsync(window.chora.LoadLibraryText(textId));
		const document = TextDocument.FromSnapshot(snapshot);

		return document;
	}

	// Loads the source attribution for a text.
	public GetSourceNoticeAsync(textId: string): Promise<SourceNotice>
	{
		return ReadOperationAsync(window.chora.GetSourceNotice(textId));
	}

	// Shows the native context menu for a passage selection.
	public ShowSelectionContextMenuAsync(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean, canExploreWord: boolean): Promise<SelectionAction>
	{
		const operation = window.chora.ShowSelectionContextMenu(canAddSignal, canAddToDreamSource, canAddToCurrentSignal, canExploreWord);
		const result = ReadOperationAsync(operation);
		return result;
	}

	// Copies the given text to the operating system clipboard.
	public CopyAsync(text: string): Promise<void>
	{
		return ReadOperationAsync(window.chora.CopySelectedText(text));
	}

	// Subscribes to the main process requesting a specific Library text be opened.
	public SubscribeToSelection(handler: (textId: string) => void): ApiSubscription
	{
		return window.chora.SubscribeLibraryTextSelected(handler);
	}

}

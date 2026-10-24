import { TextDocument, type TextDocumentSnapshot, type LibraryTextSummary, type SourceNotice } from "../../shared/library/LibraryTypes.js";
import type { SelectionAction } from "../../shared/text/TextSelection.js";
import type { ApiSubscription } from "../../shared/contracts/ChoraApi.js";

// Stateless IPC client for the Library use cases exposed by the main process.
export class LibraryGateway
{
	// Lists all texts available in the Library catalogue.
	public ListAsync(): Promise<LibraryTextSummary[]>
	{
		return window.chora.ListLibraryTexts();
	}

	// Loads one text by id for reading.
	public async LoadAsync(textId: string): Promise<TextDocument>
	{
		const snapshot = await window.chora.LoadLibraryText(textId);
		const document = TextDocument.FromSnapshot(snapshot);

		return document;
	}

	// Loads the source attribution for a text.
	public GetSourceNoticeAsync(textId: string): Promise<SourceNotice>
	{
		return window.chora.GetSourceNotice(textId);
	}

	// Shows the native context menu for a passage selection.
	public ShowSelectionContextMenuAsync(canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean): Promise<SelectionAction>
	{
		return window.chora.ShowSelectionContextMenu(canAddSignal, canAddToDreamSource, canAddToCurrentSignal);
	}

	// Copies the given text to the operating system clipboard.
	public CopyAsync(text: string): Promise<void>
	{
		return window.chora.CopySelectedText(text);
	}

	// Looks up a word using the reader's configured dictionary.
	public LookUpAsync(text: string): Promise<void>
	{
		return window.chora.LookUpWord(text);
	}

	// Subscribes to the main process requesting a specific Library text be opened.
	public SubscribeToSelection(handler: (textId: string) => void): ApiSubscription
	{
		return window.chora.SubscribeLibraryTextSelected(handler);
	}

	// Subscribes to an externally supplied text being loaded outside the Library catalogue.
	public SubscribeToExternalText(handler: (text: TextDocument) => void): ApiSubscription
	{
		function HandleSnapshot(snapshot: TextDocumentSnapshot): void
		{
			const document = TextDocument.FromSnapshot(snapshot);
			handler(document);
		}

		return window.chora.SubscribeExternalTextLoaded(HandleSnapshot);
	}
}

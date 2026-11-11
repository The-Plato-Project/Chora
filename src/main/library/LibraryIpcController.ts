import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { clipboard, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { ShowSelectionContextMenu, ShowVisionReferenceContextMenu } from "../shell/ContextMenu.js";
import { LibraryService } from "./LibraryService.js";
import type { SelectionAction } from "../../shared/text/TextSelection.js";
import {
	CreateVisionReferencePayload,
	DecodeVisionReferenceDrag,
	SerializeVisionReferenceClipboardHtml,
	type VisionReferenceDragPayload
} from "../../shared/visions/VisionReferenceTypes.js";

export class LibraryIpcController
{
	private readonly channels = [IPC_CHANNELS.listLibraryTexts, IPC_CHANNELS.loadLibraryText, IPC_CHANNELS.getSourceNotice, IPC_CHANNELS.showSelectionContextMenu, IPC_CHANNELS.showVisionReferenceContextMenu, IPC_CHANNELS.copySelectedText, IPC_CHANNELS.copySelectionAnchor] as const;

	public constructor(private readonly service: LibraryService)
	{
	}

	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.listLibraryTexts, () => this.service.ListAsync());
		IpcErrorBoundary.Register(IPC_CHANNELS.loadLibraryText, (_event, textId: string) => this.service.GetAsync(textId));
		IpcErrorBoundary.Register(IPC_CHANNELS.getSourceNotice, (_event, textId: string) => this.service.GetSourceNoticeAsync(textId));
		const showSelectionMenu = this.ShowSelectionMenuAsync.bind(this);
		IpcErrorBoundary.Register(IPC_CHANNELS.showSelectionContextMenu, showSelectionMenu);
		IpcErrorBoundary.Register(IPC_CHANNELS.showVisionReferenceContextMenu, (_event, canExploreWord: boolean) => ShowVisionReferenceContextMenu(canExploreWord));
		IpcErrorBoundary.Register(IPC_CHANNELS.copySelectedText, (_event, text: string) => clipboard.writeText(text));
		IpcErrorBoundary.Register(IPC_CHANNELS.copySelectionAnchor, (_event, payload: VisionReferenceDragPayload) => this.CopySelectionAnchorAsync(payload));
	}

	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	private async ShowSelectionMenuAsync(_event: unknown, canExploreWord: boolean): Promise<SelectionAction>
	{
		const action = await ShowSelectionContextMenu(canExploreWord);
		return action;
	}

	private async CopySelectionAnchorAsync(payload: VisionReferenceDragPayload): Promise<void>
	{
		const decoded = DecodeVisionReferenceDrag(JSON.stringify(payload));
		const document = await this.service.GetAsync(decoded.selection.dialogue);
		document.ValidateSelection(decoded.selection);
		const expected = CreateVisionReferencePayload(
			decoded.selection,
			document.GetSingleGreekWordSelection(decoded.selection));
		if (expected.anchorKind !== decoded.anchorKind)
		{
			throw new Error("The copied anchor kind does not match the selected text.");
		}
		const selectedText = document.ReconstructText(decoded.selection);
		clipboard.write({
			text: selectedText,
			html: SerializeVisionReferenceClipboardHtml(decoded, selectedText)
		});
	}

}

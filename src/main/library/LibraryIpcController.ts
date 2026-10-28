import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { clipboard, ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { ShowDreamSourceContextMenu, ShowSelectionContextMenu } from "../shell/ContextMenu.js";
import { LibraryService } from "./LibraryService.js";

export class LibraryIpcController
{
	private readonly channels = [IPC_CHANNELS.listLibraryTexts, IPC_CHANNELS.loadLibraryText, IPC_CHANNELS.getSourceNotice, IPC_CHANNELS.showSelectionContextMenu, IPC_CHANNELS.showDreamSourceContextMenu, IPC_CHANNELS.copySelectedText] as const;

	public constructor(private readonly service: LibraryService)
	{
	}

	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.listLibraryTexts, () => this.service.ListAsync());
		IpcErrorBoundary.Register(IPC_CHANNELS.loadLibraryText, (_event, textId: string) => this.service.GetAsync(textId));
		IpcErrorBoundary.Register(IPC_CHANNELS.getSourceNotice, (_event, textId: string) => this.service.GetSourceNoticeAsync(textId));
		IpcErrorBoundary.Register(IPC_CHANNELS.showSelectionContextMenu, (_event, canAddSignal: boolean, canAddToDreamSource: boolean, canAddToCurrentSignal: boolean) => ShowSelectionContextMenu(canAddSignal, canAddToDreamSource, canAddToCurrentSignal));
		IpcErrorBoundary.Register(IPC_CHANNELS.showDreamSourceContextMenu, (_event, canAddToSelectedSignal: boolean) => ShowDreamSourceContextMenu(canAddToSelectedSignal));
		IpcErrorBoundary.Register(IPC_CHANNELS.copySelectedText, (_event, text: string) => clipboard.writeText(text));
	}

	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

}

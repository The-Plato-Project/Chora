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
		ipcMain.handle(IPC_CHANNELS.listLibraryTexts, () => this.service.ListAsync());
		ipcMain.handle(IPC_CHANNELS.loadLibraryText, (_event, textId: string) => this.service.GetAsync(textId));
		ipcMain.handle(IPC_CHANNELS.getSourceNotice, (_event, textId: string) => this.service.GetSourceNoticeAsync(textId));
		ipcMain.handle(IPC_CHANNELS.showSelectionContextMenu, (_event, canAddSignal: boolean) => ShowSelectionContextMenu(canAddSignal));
		ipcMain.handle(IPC_CHANNELS.showDreamSourceContextMenu, () => ShowDreamSourceContextMenu());
		ipcMain.handle(IPC_CHANNELS.copySelectedText, (_event, text: string) => clipboard.writeText(text));
	}

	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

}

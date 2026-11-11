import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { CreateTextAnchorCommand, TextAnchorSnapshot } from "../../shared/anchors/TextAnchorTypes.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import type { TextAnchorService } from "./TextAnchorService.js";

export class TextAnchorIpcController
{
	private readonly channels = [IPC_CHANNELS.createTextAnchor, IPC_CHANNELS.listTextAnchors, IPC_CHANNELS.validateTextAnchor] as const;

	public constructor(private readonly service: TextAnchorService)
	{
	}

	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.createTextAnchor, this.HandleCreateAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.listTextAnchors, this.HandleListAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.validateTextAnchor, this.HandleValidateAsync.bind(this));
	}

	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	private HandleCreateAsync(_event: IpcMainInvokeEvent, command: CreateTextAnchorCommand): Promise<TextAnchorSnapshot>
	{
		return this.service.CreateAsync(command);
	}

	private HandleListAsync(_event: IpcMainInvokeEvent, workId: string): Promise<readonly TextAnchorSnapshot[]>
	{
		return this.service.ListAsync(workId);
	}

	private HandleValidateAsync(_event: IpcMainInvokeEvent, anchorId: string): Promise<TextAnchorSnapshot>
	{
		return this.service.ValidateAsync(anchorId);
	}
}

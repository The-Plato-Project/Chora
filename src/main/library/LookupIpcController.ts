import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { LookupBounds, LookupCommand, LookupState } from "../../shared/library/LookupTypes.js";
import { ChoraWindowManager } from "../bootstrap/WindowManager.js";
import { LookupService } from "./LookupService.js";

// Accepts dictionary commands only from Chora's own top-level renderer.
export class LookupIpcController
{
	private readonly channels = [IPC_CHANNELS.lookUpWord, IPC_CHANNELS.getLookupState, IPC_CHANNELS.setLookupBounds, IPC_CHANNELS.lookupCommand];

	public constructor(private readonly service: LookupService, private readonly windows: ChoraWindowManager)
	{
	}

	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.lookUpWord, this.OpenAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.getLookupState, this.GetState.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.setLookupBounds, this.SetBounds.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.lookupCommand, this.ExecuteAsync.bind(this));
	}

	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
		this.service.Close();
	}

	private ValidateSender(event: IpcMainInvokeEvent): void
	{
		const owner = this.windows.GetWindow()?.webContents;
		if (owner === undefined || event.sender !== owner || event.senderFrame !== owner.mainFrame) throw ApplicationError.Expected("validation", "INVALID_LOOKUP_COMMAND", "Untrusted dictionary request.");
	}

	private async OpenAsync(event: IpcMainInvokeEvent, text: unknown): Promise<void>
	{
		this.ValidateSender(event);
		if (typeof text !== "string" || text.length > 20000) throw ApplicationError.Expected("validation", "INVALID_LOOKUP_COMMAND", "Invalid lookup text.");
		await this.service.OpenAsync(text);
	}

	private GetState(event: IpcMainInvokeEvent): LookupState
	{
		this.ValidateSender(event);
		const state = this.service.GetState();
		return state;
	}

	private SetBounds(event: IpcMainInvokeEvent, value: unknown): void
	{
		this.ValidateSender(event);
		if (value !== null)
		{
			if (typeof value !== "object") throw ApplicationError.Expected("validation", "INVALID_LOOKUP_COMMAND", "Invalid dictionary bounds.");
			const candidate = value as Record<string, unknown>;
			for (const key of ["x", "y", "width", "height"])
			{
				if (typeof candidate[key] !== "number" || !Number.isFinite(candidate[key])) throw ApplicationError.Expected("validation", "INVALID_LOOKUP_COMMAND", "Invalid dictionary bounds.");
			}
			if ((candidate.width as number) < 0 || (candidate.height as number) < 0) throw ApplicationError.Expected("validation", "INVALID_LOOKUP_COMMAND", "Invalid dictionary dimensions.");
		}
		this.service.SetBounds(value as LookupBounds | null);
	}

	private async ExecuteAsync(event: IpcMainInvokeEvent, command: unknown): Promise<void>
	{
		this.ValidateSender(event);
		if (command !== "back" && command !== "forward" && command !== "reload" && command !== "external" && command !== "close") throw ApplicationError.Expected("validation", "INVALID_LOOKUP_COMMAND", "Invalid dictionary command.");
		await this.service.ExecuteAsync(command as LookupCommand);
	}
}
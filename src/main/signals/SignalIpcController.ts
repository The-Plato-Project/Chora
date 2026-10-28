import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";
import { DreamService } from "../dreams/DreamService.js";

// Exposes Dream-owned Signal use cases to the isolated renderer.
export class SignalIpcController
{
	// Contains every IPC channel owned by this controller.
	private readonly channels = [IPC_CHANNELS.createSignal, IPC_CHANNELS.updateSignal, IPC_CHANNELS.deleteSignal] as const;

	public constructor(private readonly service: DreamService)
	{
	}

	// Registers Signal IPC handlers.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.createSignal, this.HandleCreateAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.updateSignal, this.HandleUpdateAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.deleteSignal, this.HandleDeleteAsync.bind(this));
	}

	// Removes Signal IPC handlers.
	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	// Creates one Signal in its owning Dream.
	private HandleCreateAsync(_event: IpcMainInvokeEvent, command: CreateSignalCommand): Promise<SignalRecord>
	{
		const created = this.service.CreateSignalAsync(command);

		return created;
	}

	// Updates one Signal without changing its ownership.
	private HandleUpdateAsync(_event: IpcMainInvokeEvent, command: UpdateSignalCommand): Promise<SignalRecord>
	{
		const updated = this.service.UpdateSignalAsync(command);

		return updated;
	}

	// Deletes one Signal from its owning Dream.
	private HandleDeleteAsync(_event: IpcMainInvokeEvent, command: DeleteSignalCommand): Promise<void>
	{
		const deletion = this.service.DeleteSignalAsync(command);

		return deletion;
	}
}

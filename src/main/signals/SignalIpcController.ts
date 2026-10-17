import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { SaveSignalCommand, SignalRecord } from "../../shared/signals/SignalTypes.js";
import { SignalLibrary } from "./SignalLibrary.js";

// Exposes work-owned Signal use cases to the isolated renderer.
export class SignalIpcController
{
	// Contains every IPC channel owned by this controller.
	private readonly channels = [IPC_CHANNELS.listSignals, IPC_CHANNELS.saveSignal] as const;

	public constructor(private readonly library: SignalLibrary)
	{
	}

	// Registers Signal IPC handlers.
	public Register(): void
	{
		ipcMain.handle(IPC_CHANNELS.listSignals, this.HandleListAsync.bind(this));
		ipcMain.handle(IPC_CHANNELS.saveSignal, this.HandleSaveAsync.bind(this));
	}

	// Removes Signal IPC handlers.
	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	// Lists one work's Signals.
	private HandleListAsync(_event: IpcMainInvokeEvent, workId: string): Promise<SignalRecord[]>
	{
		return this.library.ListAsync(workId);
	}

	// Saves one Signal.
	private HandleSaveAsync(_event: IpcMainInvokeEvent, command: SaveSignalCommand): Promise<SignalRecord>
	{
		return this.library.SaveAsync(command);
	}
}

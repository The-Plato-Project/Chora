import type { SaveSignalCommand, SignalRecord } from "../../shared/signals/SignalTypes.js";

// Stateless IPC client for work-owned Signals.
export class SignalGateway
{
	// Lists one work's Signals.
	public ListAsync(workId: string): Promise<SignalRecord[]>
	{
		return window.chora.ListSignals(workId);
	}

	// Creates or updates one Signal.
	public SaveAsync(command: SaveSignalCommand): Promise<SignalRecord>
	{
		return window.chora.SaveSignal(command);
	}
}

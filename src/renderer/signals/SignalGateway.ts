import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";

// Stateless IPC client for Dream-owned Signals.
export class SignalGateway
{
	// Creates one Signal inside exactly one Dream.
	public CreateAsync(command: CreateSignalCommand): Promise<SignalRecord>
	{
		return ReadOperationAsync(window.chora.CreateSignal(command));
	}

	// Updates one Signal without changing its ownership.
	public UpdateAsync(command: UpdateSignalCommand): Promise<SignalRecord>
	{
		return ReadOperationAsync(window.chora.UpdateSignal(command));
	}

	// Deletes one Signal from its owning Dream.
	public DeleteAsync(command: DeleteSignalCommand): Promise<void>
	{
		return ReadOperationAsync(window.chora.DeleteSignal(command));
	}
}

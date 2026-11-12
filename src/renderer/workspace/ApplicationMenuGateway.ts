import type { ApplicationMenuCommand } from "../../shared/contracts/ChoraApi.js";
import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";

// Stateless IPC access for application-owned menu commands.
export class ApplicationMenuGateway
{
	// Keeps native actions outside renderer controls and panels.
	public async ExecuteAsync(command: ApplicationMenuCommand): Promise<void>
	{
		const operation = window.chora.ExecuteApplicationMenuCommand(command);
		await ReadOperationAsync(operation);
	}
}

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ChoraWindowManager } from "../bootstrap/WindowManager.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { ExecuteApplicationMenuCommandAsync } from "./ApplicationMenu.js";

// Restricts privileged menu commands to the application's trusted main renderer frame.
export class ApplicationMenuIpcController
{
	// Uses the application's existing native window authority.
	public constructor(private readonly windows: ChoraWindowManager)
	{
	}

	// Installs the menu boundary alongside the other application commands.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.applicationMenuCommand, this.ExecuteAsync.bind(this));
	}

	// Removes the handler when the application stops or startup rolls back.
	public Unregister(): void
	{
		ipcMain.removeHandler(IPC_CHANNELS.applicationMenuCommand);
	}

	// Accepts a fixed command vocabulary instead of arbitrary native menu objects.
	private async ExecuteAsync(event: IpcMainInvokeEvent, command: unknown): Promise<void>
	{
		const contents = this.windows.GetWindow()?.webContents;
		if (contents === undefined || event.sender !== contents || event.senderFrame !== contents.mainFrame)
		{
			throw ApplicationError.Expected("validation", "UNTRUSTED_MENU_COMMAND", "Untrusted application menu request.");
		}
		if (command !== "quit" && command !== "settings" && command !== "logs")
		{
			throw ApplicationError.Expected("validation", "INVALID_MENU_COMMAND", "Unknown application menu command.");
		}
		await ExecuteApplicationMenuCommandAsync(command);
	}
}

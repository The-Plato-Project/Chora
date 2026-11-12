import { Errors } from "../diagnostics/MainErrorManager.js";
import { app, BrowserWindow, dialog, shell, Menu, type MenuItemConstructorOptions } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { ApplicationMenuCommand } from "../../shared/contracts/ChoraApi.js";

// Shares application actions between the native macOS menu and the renderer menu boundary.
export async function ExecuteApplicationMenuCommandAsync(command: ApplicationMenuCommand): Promise<void>
{
	if (command === "quit")
	{
		app.quit();
	}
	else if (command === "settings")
	{
		OpenSettings();
	}
	else if (command === "logs")
	{
		await OpenLogsAsync();
	}
}

// Creates native application commands for the bundled Library reading environment.
export function CreateApplicationMenu(): Menu
{
	const menuTemplate: MenuItemConstructorOptions[] = [
		{
			label: "File",
			submenu: [
				{
					role: "quit"
				}
			]
		},
		{
			label: "Settings",
			submenu: [{ label: "Chora settings", accelerator: "CmdOrCtrl+,", click: OpenSettings }]
		},
		{
			label: "Help",
			submenu: [{ label: "Open Logs Folder", click: OpenLogsAsync }]
		}
	];
	const menu = Menu.buildFromTemplate(menuTemplate);

	return menu;
}

// Requests renderer-owned preferences without moving application settings into Electron.
function OpenSettings(): void
{
	const window = BrowserWindow.getFocusedWindow();
	if (window !== null && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.openSettings);
}

// Exposes the authoritative logs location and reports storage health without requesting renderer paths.
async function OpenLogsAsync(): Promise<void>
{
	try
	{
		await Errors.FlushAsync();
		const storageError = Errors.GetStorageError();
		if (storageError !== null)
		{
			dialog.showErrorBox("Logging unavailable", "Chora could not write its diagnostic log. Check available disk space and permissions. Recent diagnostics remain in memory.");
		}
		const result = await shell.openPath(app.getPath("logs"));
		if (result.length > 0) throw new Error(result);
	}
	catch (error)
	{
		Errors.Report("ApplicationMenu.Logs", error, "The logs folder could not be opened.");
	}
}

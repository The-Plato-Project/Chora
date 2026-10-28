import { Errors } from "../diagnostics/MainErrorManager.js";
import { app, dialog, shell, Menu, type MenuItemConstructorOptions } from "electron";

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
			label: "Help",
			submenu: [{ label: "Open Logs Folder", click: OpenLogsAsync }]
		}
	];
	const menu = Menu.buildFromTemplate(menuTemplate);

	return menu;
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

import { app, BrowserWindow } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { ChoraApplication } from "./bootstrap/ChoraApplication.js";
import { EnvironmentFile } from "./bootstrap/EnvironmentFile.js";
import { Errors } from "./diagnostics/MainErrorManager.js";
import { InstallProcessOutputGuard } from "./diagnostics/ProcessOutputGuard.js";

InstallProcessOutputGuard();
EnvironmentFile.LoadFromWorkingDirectory();

let application: ChoraApplication | null = null;

app.disableHardwareAcceleration();

async function StartApplicationAsync(): Promise<void>
{
	if (application === null)
	{
		const documentsPath = app.getPath("documents");
		application = new ChoraApplication(documentsPath);
	}

	await application.StartAsync();
}

// Reports a failed application start and stops Electron when recovery is impossible.
function HandleApplicationStartFailure(error: unknown): void
{
	const message = error instanceof Error ? error.message : "Unable to start application.";
	Errors.Error("Application", message, error);
	app.quit();
}

// Starts Chora after Electron has initialized its native services.
function HandleElectronReady(): void
{
	void StartApplicationAsync().catch(HandleApplicationStartFailure);
}

// Stops main-process feature modules before Electron exits.
function HandleBeforeQuit(): void
{
	if (application !== null)
	{
		application.Stop();
	}
}

// Closes Chora when no windows remain on non-macOS platforms.
function HandleAllWindowsClosed(): void
{
	if (process.platform !== "darwin")
	{
		app.quit();
	}
}

// Reopens Chora's window when macOS activates an already-running application.
function HandleActivate(): void
{
	if (BrowserWindow.getAllWindows().length === 0)
	{
		if (application !== null)
		{
			application.OpenWindow();
		}
	}
}

if (squirrelStartup)
{
	app.quit();
}

app.whenReady().then(HandleElectronReady);

app.on("before-quit", HandleBeforeQuit);

app.on("window-all-closed", HandleAllWindowsClosed);

app.on("activate", HandleActivate);

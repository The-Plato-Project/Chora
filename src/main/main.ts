import { app, BrowserWindow } from "electron";
import squirrelStartup from "electron-squirrel-startup";
import { ChoraApplication } from "./bootstrap/ChoraApplication.js";
import { Errors } from "./diagnostics/MainErrorManager.js";
import { InstallProcessOutputGuard } from "./diagnostics/ProcessOutputGuard.js";

InstallProcessOutputGuard();

let application: ChoraApplication | null = null;
// Prevents recursive shutdown while the diagnostic queue drains.
let isFinalQuit = false;
// Shares one graceful diagnostic flush across repeated quit requests.
let isFlushingQuit = false;

app.disableHardwareAcceleration();

async function StartApplicationAsync(): Promise<void>
{
	if (application === null)
	{
		const documentsPath = app.getPath("documents");
		const internalPath = app.getPath("userData");
		application = new ChoraApplication(documentsPath, internalPath);
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
	Errors.Configure(app.getPath("logs"));
	Errors.Info("Application", "Application starting.");
	void StartApplicationAsync().catch(HandleApplicationStartFailure);
}

// Stops main-process feature modules before Electron exits.
function HandleBeforeQuit(event: Electron.Event): void
{
	if (!isFinalQuit)
	{
		event.preventDefault();
		if (!isFlushingQuit)
		{
			isFlushingQuit = true;
			void FinishQuitAsync();
		}
	}
}

// Stops modules and waits for admitted diagnostic writes before permitting Electron to exit.
async function FinishQuitAsync(): Promise<void>
{
	try
	{
		await application?.StopAsync();
	}
	catch (error)
	{
		Errors.Capture("Application.Shutdown", error);
	}
	await Errors.FlushAsync();
	isFinalQuit = true;
	app.quit();
}

// Preserves otherwise unhandled async failures for logging and user reporting.
function HandleUnhandledRejection(error: unknown): void
{
	Errors.Report("Process.UnhandledRejection", error, "An unexpected background operation failed. Check your current work before continuing.");
}

// Preserves a fatal exception before terminating a process whose state is no longer trustworthy.
function HandleUncaughtException(error: Error): void
{
	Errors.Capture("Process.UncaughtException", error);
	// Terminates only after the queued diagnostic append has finished.
	function Exit(): void
	{
		app.exit(1);
	}
	void Errors.FlushAsync().then(Exit, Exit);
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

process.on("unhandledRejection", HandleUnhandledRejection);
process.on("uncaughtException", HandleUncaughtException);

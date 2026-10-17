import { app, BrowserWindow, type ContextMenuParams, type Event, type RenderProcessGoneDetails } from "electron";
import path from "node:path";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { ShowEditContextMenu, ShowFormattingContextMenu } from "../shell/ContextMenu.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";

// Owns Chora's single native BrowserWindow instance and its lifecycle.
export class ChoraWindowManager
{
	// The currently open window, or null when no window is open.
	private window: BrowserWindow | null = null;

	// Returns the existing window, or creates and opens a new one.
	public Open(): BrowserWindow
	{
		if (this.window === null)
		{
			this.window = this.Create();
		}

		return this.window;
	}

	// Returns the current window, or null when no window is open.
	public GetWindow(): BrowserWindow | null
	{
		return this.window;
	}

	private Create(): BrowserWindow
	{
		const window = new BrowserWindow({
			width: 1500,
			height: 960,
			minWidth: 760,
			minHeight: 540,
			resizable: true,
			show: false,
			backgroundColor: "#0f1115",
			webPreferences: {
				preload: path.join(app.getAppPath(), ".vite", "build", "src", "preload", "preload.js"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true
			}
		});
		void window.loadFile(path.join(app.getAppPath(), ".vite", "renderer", "src", "renderer", "index.html"))
			.then(this.HandleLoadSuccess.bind(this, window), this.HandleLoadFailure.bind(this));
		window.on("closed", this.HandleWindowClosed.bind(this, window));
		window.webContents.on("context-menu", this.HandleContextMenu.bind(this, window));
		window.webContents.on("render-process-gone", this.HandleRenderProcessGone.bind(this));
		window.on("unresponsive", this.HandleWindowUnresponsive.bind(this));

		return window;
	}

	// Owns the first native show, then normalizes a minimized state inherited from the launcher.
	private HandleLoadSuccess(window: BrowserWindow): void
	{
		if (!window.isDestroyed())
		{
			window.show();
			if (window.isMinimized()) window.restore();
		}
	}

	// Reports renderer-document load failures that would otherwise leave the startup window hidden.
	private HandleLoadFailure(error: unknown): void
	{
		Errors.Error("ElectronWindow", "Chora window content could not be loaded.", error);
	}

	// Clears the tracked window once the given window has closed.
	private HandleWindowClosed(window: BrowserWindow): void
	{
		if (this.window === window) this.window = null;
	}

	// Shows the native editing menu for a right-clicked editable field.
	private async HandleContextMenu(window: BrowserWindow, _event: Event, params: ContextMenuParams): Promise<void>
	{
		if (params.isEditable)
		{
			if (params.formControlType === "none")
			{
				const action = await ShowFormattingContextMenu(window, params);
				if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.showFormattingContextMenu, action);
			}
			else ShowEditContextMenu(window, params);
		}
	}

	// Reports an unexpected renderer process termination.
	private HandleRenderProcessGone(_event: Event, details: RenderProcessGoneDetails): void
	{
		Errors.Error("ElectronWindow", "Chora browser process ended.", details);
	}

	// Reports that the window's renderer stopped responding.
	private HandleWindowUnresponsive(): void
	{
		Errors.Error("ElectronWindow", "Chora window became unresponsive.");
	}
}

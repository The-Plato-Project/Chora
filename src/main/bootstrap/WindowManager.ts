import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { app, BrowserWindow, screen, type ContextMenuParams, type Event, type Rectangle, type RenderProcessGoneDetails } from "electron";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { ShowEditContextMenu, ShowFormattingContextMenu } from "../shell/ContextMenu.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";

// Normal bounds remain independent of maximized and fullscreen presentation.
interface WindowState
{
	readonly bounds: Rectangle;
	readonly maximized: boolean;
	readonly fullscreen: boolean;
}

// Owns Chora's single native BrowserWindow instance and its lifecycle.
export class ChoraWindowManager
{
	// The currently open window, or null when no window is open.
	private window: BrowserWindow | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private state: WindowState | null = null;
	// Native startup events must not overwrite the saved presentation before it is applied.
	private windowReady = false;

	// The Electron host owns native geometry in its internal application-data directory.
	public constructor(private readonly statePath: string | null = null)
	{
	}

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
		this.windowReady = false;
		this.state = this.LoadState();
		const window = new BrowserWindow({
			width: this.state?.bounds.width ?? 1500,
			height: this.state?.bounds.height ?? 960,
			...(this.state === null ? {} : { x: this.state.bounds.x, y: this.state.bounds.y }),
			minWidth: Math.min(760, this.state?.bounds.width ?? 760),
			minHeight: Math.min(540, this.state?.bounds.height ?? 540),
			resizable: true,
			...(process.platform === "win32" ? { roundedCorners: false } : {}),
			show: false,
			backgroundColor: "#eee9df",
			title: "Chora",
			autoHideMenuBar: false,
			accentColor: false,
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
		window.on("close", this.SaveState.bind(this, window));
		const scheduleSave = this.ScheduleSave.bind(this, window);
		window.on("move", scheduleSave);
		window.on("resize", scheduleSave);
		window.on("maximize", scheduleSave);
		window.on("unmaximize", scheduleSave);
		window.on("enter-full-screen", scheduleSave);
		window.on("leave-full-screen", scheduleSave);
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
			if (this.state?.maximized) window.maximize();
			if (this.state?.fullscreen) window.setFullScreen(true);
			window.show();
			if (window.isMinimized()) window.restore();
			this.windowReady = true;
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
		if (this.saveTimer !== null) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		if (this.window === window) this.window = null;
	}

	// Geometry changes are coalesced, with a final synchronous checkpoint on native close.
	private ScheduleSave(window: BrowserWindow): void
	{
		if (this.statePath !== null && this.windowReady)
		{
			if (this.saveTimer !== null) clearTimeout(this.saveTimer);
			this.saveTimer = setTimeout(this.SaveState.bind(this, window), 250);
		}
	}

	private SaveState(window: BrowserWindow): void
	{
		if (this.saveTimer !== null) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		if (this.statePath !== null && this.windowReady && !window.isDestroyed() && !window.isMinimized())
		{
			try
			{
				this.state = { bounds: window.getNormalBounds(), maximized: window.isMaximized(), fullscreen: window.isFullScreen() };
				mkdirSync(path.dirname(this.statePath), { recursive: true });
				const temporaryPath = `${this.statePath}.tmp`;
				writeFileSync(temporaryPath, JSON.stringify(this.state), "utf8");
				renameSync(temporaryPath, this.statePath);
			}
			catch (error)
			{
				Errors.Error("ElectronWindow", "Could not save native window state.", error);
			}
		}
	}

	// Clamps saved bounds to an attached display, including after monitors are removed.
	private LoadState(): WindowState | null
	{
		let state: WindowState | null = null;
		if (this.statePath !== null)
		{
			try
			{
				if (existsSync(this.statePath))
				{
					const value = JSON.parse(readFileSync(this.statePath, "utf8")) as Partial<WindowState>;
					const bounds = value?.bounds;
					if (bounds !== undefined && bounds !== null
						&& Number.isSafeInteger(bounds.x) && Number.isSafeInteger(bounds.y)
						&& Number.isSafeInteger(bounds.width) && bounds.width > 0
						&& Number.isSafeInteger(bounds.height) && bounds.height > 0)
					{
						const area = screen.getDisplayMatching(bounds).workArea;
						const width = Math.min(area.width, Math.max(760, bounds.width));
						const height = Math.min(area.height, Math.max(540, bounds.height));
						const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
						const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
						state = { bounds: { x, y, width, height }, maximized: value.maximized === true, fullscreen: value.fullscreen === true };
					}
				}
			}
			catch (error)
			{
				Errors.Error("ElectronWindow", "Could not restore native window state.", error);
			}
		}
		return state;
	}

	// Shows the native editing menu for a right-clicked editable field.
	private async HandleContextMenu(window: BrowserWindow, _event: Event, params: ContextMenuParams): Promise<void>
	{
		if (params.isEditable)
		{
			if (params.formControlType === "none")
			{
				try
				{
					const action = await ShowFormattingContextMenu(window, params);
					if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.showFormattingContextMenu, { ok: true, value: action });
				}
				catch (error)
				{
					const failure = IpcErrorBoundary.Capture(IPC_CHANNELS.showFormattingContextMenu, error);
					if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.showFormattingContextMenu, { ok: false, error: failure });
				}
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

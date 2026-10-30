import { DiagnosticIpcController } from "../diagnostics/DiagnosticIpcController.js";
import { ModelIpcController } from "../models/ModelIpcController.js";
import { Menu } from "electron";
import { DreamModule } from "../dreams/DreamModule.js";
import { LibraryModule } from "../library/LibraryModule.js";
import { CreateApplicationMenu } from "../shell/ApplicationMenu.js";
import { LoadEnvironmentFiles } from "./Environment.js";
import { ChoraWindowManager } from "./WindowManager.js";
import { LookupService } from "../library/LookupService.js";
import { LookupIpcController } from "../library/LookupIpcController.js";

// Composes, starts, and stops Chora's main-process feature modules.
export class ChoraApplication
{
	// Owns Chora's native window lifecycle.
	private readonly windows = new ChoraWindowManager();
	// Exposes the model catalogue independently of Dream workflows.
	private readonly models = new ModelIpcController();
	// Owns validated renderer-log ingestion for the application window.
	private readonly diagnostics = new DiagnosticIpcController(this.windows);
	private readonly lookupService = new LookupService(this.windows);
	private readonly lookup = new LookupIpcController(this.lookupService, this.windows);
// Owns access to the bundled Library and its IPC boundary.
	private readonly library = new LibraryModule();
// Owns Dream persistence for this application run.
	private readonly dreams: DreamModule;
	// Owns the application-level startup and shutdown transition.
	private lifecycle: "stopped" | "starting" | "started" = "stopped";

	// Creates the application from its operating-system-owned documents path.
	public constructor(documentsPath: string)
	{
		this.dreams = new DreamModule(documentsPath, this.library.GetService());
	}

	// Loads configuration, starts modules, opens the window, and builds the application menu.
	public async StartAsync(): Promise<void>
	{
		if (this.lifecycle === "started" || this.lifecycle === "starting")
		{
			return;
		}

		this.lifecycle = "starting";
		try
		{
			LoadEnvironmentFiles();

			// Start modules before opening the window so that the window can be populated with content.
			this.StartModules();

			// Open the window before building the menu so that the menu can be built with the window's context.
			this.OpenWindow();

			// Install native commands after opening the application window.
			this.BuildMenu();

			this.lifecycle = "started";
		}
		catch (error)
		{
			this.StopModules();
			this.lifecycle = "stopped";
			throw error;
		}
	}

	// Stops feature modules before Electron tears down the main process.
	public Stop(): void
	{
		if (this.lifecycle !== "stopped")
		{
			this.StopModules();
			this.lifecycle = "stopped";
		}
	}

	// Opens the existing window or creates a replacement window after macOS activation.
	public OpenWindow(): void
	{
		this.windows.Open();
	}

	// Installs the native application menu without loading or opening external files.
	private BuildMenu(): void
	{
		const menu = CreateApplicationMenu();
		Menu.setApplicationMenu(menu);
	}

	private StartModules(): void
	{
		this.diagnostics.Register();
		this.library.Start();
		this.models.Register();
		this.lookup.Register();
		this.dreams.Start();
	}

	private StopModules(): void
	{
		this.diagnostics.Unregister();
		this.lookup.Unregister();
		this.dreams.Stop();
		this.models.Unregister();
		this.library.Stop();
	}
}
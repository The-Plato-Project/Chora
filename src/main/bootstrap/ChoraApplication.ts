import { DiagnosticIpcController } from "../diagnostics/DiagnosticIpcController.js";
import { Menu } from "electron";
import path from "node:path";
import { LibraryModule } from "../library/LibraryModule.js";
import { CreateApplicationMenu } from "../shell/ApplicationMenu.js";
import { LoadEnvironmentFiles } from "./Environment.js";
import { ChoraWindowManager } from "./WindowManager.js";
import { PlatoSiClient } from "../platosi/PlatoSiClient.js";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { VisionModule } from "../visions/VisionModule.js";
import { AppearanceIpcController } from "../shell/AppearanceIpcController.js";
import { ApplicationMenuIpcController } from "../shell/ApplicationMenuIpcController.js";

// Composes, starts, and stops Chora's main-process feature modules.
export class ChoraApplication
{
	// Owns Chora's native window lifecycle.
	private readonly windows: ChoraWindowManager;
	// Owns validated renderer-log ingestion for the application window.
	private readonly diagnostics: DiagnosticIpcController;
	// Owns the validated renderer-to-native appearance command.
	private readonly appearance: AppearanceIpcController;
	// Owns privileged commands from the reusable application menu bar.
	private readonly menuCommands: ApplicationMenuIpcController;
	// Owns the PlatoSI dependency for the application lifetime.
	private platosi: PlatoSiClient | null = null;
	// Owns access to the Library and its IPC boundary.
	private library: LibraryModule | null = null;
	// Owns Vision persistence for this application run.
	private visions: VisionModule | null = null;
	// Owns the application-level startup and shutdown transition.
	private lifecycle: "stopped" | "starting" | "started" = "stopped";

	// Creates the application from its operating-system-owned documents path.
	public constructor(private readonly documentsPath: string, private readonly internalPath: string)
	{
		this.windows = new ChoraWindowManager(path.join(this.internalPath, "window-state.json"));
		this.diagnostics = new DiagnosticIpcController(this.windows);
		this.appearance = new AppearanceIpcController(this.windows);
		this.menuCommands = new ApplicationMenuIpcController(this.windows);
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
			this.CreateModules();
			const platosi = this.RequirePlatoSi();
			const visions = this.RequireVisions();
			await platosi.StartAsync();
			await visions.PrepareAsync();

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
			try
			{
				try
				{
					this.StopModules();
				}
				finally
				{
					await this.platosi?.StopAsync();
				}
			}
			catch (cleanupError)
			{
				Errors.Capture("Application.StartupCleanup", cleanupError);
			}
			this.platosi = null;
			this.library = null;
			this.visions = null;
			this.lifecycle = "stopped";
			throw error;
		}
	}

	// Stops feature modules before Electron tears down the main process.
	public async StopAsync(): Promise<void>
	{
		if (this.lifecycle !== "stopped")
		{
			this.lifecycle = "stopped";
			try
			{
				this.StopModules();
			}
			finally
			{
				await this.platosi?.StopAsync();
			}
			this.platosi = null;
			this.library = null;
			this.visions = null;
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
		const menu = process.platform === "darwin" ? CreateApplicationMenu() : null;
		Menu.setApplicationMenu(menu);
	}

	private StartModules(): void
	{
		const library = this.RequireLibrary();
		const visions = this.RequireVisions();
		this.diagnostics.Register();
		this.appearance.Register();
		this.menuCommands.Register();
		library.Start();
		visions.Start();
	}

	private StopModules(): void
	{
		this.visions?.Stop();
		this.library?.Stop();
		this.diagnostics.Unregister();
		this.appearance.Unregister();
		this.menuCommands.Unregister();
	}

	// Constructs one fresh dependency graph after local configuration has loaded.
	private CreateModules(): void
	{
		const pythonPath = process.env.PLATOSI_PYTHON ?? "";
		const readerApiPath = process.env.PLATOSI_READER_API ?? "";
		const platosi = new PlatoSiClient(pythonPath, readerApiPath);
		const library = new LibraryModule(platosi, this.internalPath);
		this.platosi = platosi;
		this.library = library;
		this.visions = new VisionModule(this.documentsPath, library.GetService());
	}

	// Returns the configured PlatoSI client.
	private RequirePlatoSi(): PlatoSiClient
	{
		if (this.platosi === null) throw new Error("PlatoSI has not been configured.");
		return this.platosi;
	}

	// Returns the configured Library module.
	private RequireLibrary(): LibraryModule
	{
		if (this.library === null) throw new Error("Library has not been configured.");
		return this.library;
	}

	private RequireVisions(): VisionModule
	{
		if (this.visions === null) throw new Error("Visions have not been configured.");
		return this.visions;
	}
}

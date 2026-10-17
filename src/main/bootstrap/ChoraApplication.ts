import { Menu } from "electron";
import { DreamModule } from "../dreams/DreamModule.js";
import { LibraryModule } from "../library/LibraryModule.js";
import { IdeaModule } from "../ideas/IdeaModule.js";
import { CreateApplicationMenu } from "../shell/ApplicationMenu.js";
import { LoadEnvironmentFiles } from "./Environment.js";
import { ChoraWindowManager } from "./WindowManager.js";
import { LookupService } from "../library/LookupService.js";
import { LookupIpcController } from "../library/LookupIpcController.js";
import { SignalModule } from "../signals/SignalModule.js";

// Composes, starts, and stops Chora's main-process feature modules.
export class ChoraApplication
{
	// Owns Chora's native window lifecycle.
	private readonly windows = new ChoraWindowManager();
	private readonly lookupService = new LookupService(this.windows);
	private readonly lookup = new LookupIpcController(this.lookupService, this.windows);
// Owns access to the bundled Library and its IPC boundary.
	private readonly library = new LibraryModule();
	private readonly signals: SignalModule;
// Owns Dream persistence for this application run.
	private readonly dreams: DreamModule;
// Owns work-scoped Signal-grounded Ideas.
	private readonly ideas: IdeaModule;
	// Owns the application-level startup and shutdown transition.
	private lifecycle: "stopped" | "starting" | "started" = "stopped";

	// Creates the application from its operating-system-owned documents path.
	public constructor(documentsPath: string)
	{
		this.signals = new SignalModule(documentsPath, this.library.GetService());
		this.dreams = new DreamModule(documentsPath, this.signals.GetLibrary());
		this.ideas = new IdeaModule(documentsPath, this.signals.GetLibrary());
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

			// Build the application menu after the Library has been started and its works have been loaded.
			await this.BuildMenu();

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

	private async BuildMenu(): Promise<void>
	{
		const works = await this.library.GetService().ListAsync();
		const menu = CreateApplicationMenu(this.windows, works);
		Menu.setApplicationMenu(menu);
	}

	private StartModules(): void
	{
		this.library.Start();
		this.signals.Start();
		this.lookup.Register();
		this.ideas.Start();
		this.dreams.Start();
	}

	private StopModules(): void
	{
		this.lookup.Unregister();
		this.dreams.Stop();
		this.ideas.Stop();
		this.signals.Stop();
		this.library.Stop();
	}
}
import path from "node:path";
import { ApplicationModule } from "../bootstrap/ApplicationModule.js";
import { DreamLibrary } from "./DreamLibrary.js";
import { DreamIpcController } from "./DreamIpcController.js";
import { DreamRepository } from "./DreamRepository.js";
import { DreamService } from "./DreamService.js";
import { DreamSynopticViewService } from "./DreamSynopticViewService.js";
import type { SignalLibrary } from "../signals/SignalLibrary.js";

// Owns Dream library composition and IPC registration.
export class DreamModule extends ApplicationModule
{
	// Dream behavior backed by the Dream persistence root.
	private readonly service: DreamService;
	private readonly synopticViews = new DreamSynopticViewService();
// Renderer IPC controller owned by this module.
	private readonly ipcController: DreamIpcController;

	// Creates the module from the operating system's documents directory.
	public constructor(documentsPath: string, signals: SignalLibrary)
	{
		super();
		const primaryPath = path.join(documentsPath, "Chora", "Dreams");
		const repository = new DreamRepository(primaryPath);
		const library = new DreamLibrary(primaryPath, repository, signals);
		this.service = new DreamService(library);
		this.ipcController = new DreamIpcController(this.service, this.synopticViews);
	}

	// Exposes the authoritative Dream use cases to other main-process modules.
	public GetService(): DreamService
	{
		const service = this.service;

		return service;
	}

	// Registers the Dreams IPC boundary.
	protected StartCore(): void
	{
		this.ipcController.Register();
	}

	// Removes the Dreams IPC boundary.
	protected StopCore(): void
	{
		this.ipcController.Unregister();
		this.synopticViews.Stop();
	}
}
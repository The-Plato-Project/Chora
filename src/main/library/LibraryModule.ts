import { ApplicationModule } from "../bootstrap/ApplicationModule.js";
import { LibraryIpcController } from "./LibraryIpcController.js";
import { LibraryService } from "./LibraryService.js";
import { PlatoSiLibraryRepository } from "./PlatoSiLibraryRepository.js";
import type { PlatoSiClient } from "../platosi/PlatoSiClient.js";
import { PlatoSiGateway } from "../platosi/PlatoSiGateway.js";
import { WordExplorationIpcController } from "./WordExplorationIpcController.js";
import { WordObservationRepository } from "./WordObservationRepository.js";
import { WordExplorationService } from "./WordExplorationService.js";

// Owns Library composition and its renderer-facing IPC boundary.
export class LibraryModule extends ApplicationModule
{
	// Library behavior shared with dependent main-process features.
	private readonly service: LibraryService;
	// Renderer IPC controller owned by this module.
	private readonly ipcController: LibraryIpcController;
	private readonly words: WordExplorationService;
	private readonly wordsIpc: WordExplorationIpcController;

	// Shares the application-owned PlatoSI connection across Library workflows.
	public constructor(client: PlatoSiClient, internalPath: string)
	{
		super();
		const platosi = new PlatoSiGateway(client);
		const repository = new PlatoSiLibraryRepository(platosi);
		this.service = new LibraryService(repository);
		this.ipcController = new LibraryIpcController(this.service);
		const observations = new WordObservationRepository(internalPath);
		this.words = new WordExplorationService(this.service, platosi, observations);
		this.wordsIpc = new WordExplorationIpcController(this.words);
	}

	// Returns the Library behavior required by other main-process modules.
	public GetService(): LibraryService
	{
		return this.service;
	}

	// Registers the Library IPC boundary.
	protected StartCore(): void
	{
		this.ipcController.Register();
		this.wordsIpc.Register();
	}

	// Removes the Library IPC boundary.
	protected StopCore(): void
	{
		this.wordsIpc.Unregister();
		this.ipcController.Unregister();
	}
}
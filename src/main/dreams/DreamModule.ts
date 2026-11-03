import { ChatRepository } from "../chat/ChatRepository.js";
import path from "node:path";
import { ApplicationModule } from "../bootstrap/ApplicationModule.js";
import { DreamLibrary } from "./DreamLibrary.js";
import { DreamIpcController } from "./DreamIpcController.js";
import { DreamRepository } from "./DreamRepository.js";
import { DreamService } from "./DreamService.js";
import type { LibraryService } from "../library/LibraryService.js";
import { SignalIpcController } from "../signals/SignalIpcController.js";
import { SignalMarkdownCodec } from "../signals/SignalMarkdownCodec.js";
import { SignalRepository } from "../signals/SignalRepository.js";
import { WorkStoragePaths } from "./WorkStoragePaths.js";
import { DreamStorageMigration } from "./DreamStorageMigration.js";

// Owns Dream library composition and IPC registration.
export class DreamModule extends ApplicationModule
{
	// Dream behavior backed by the Dream persistence root.
	private readonly service: DreamService;
	// Renderer Dream IPC controller owned by this module.
	private readonly ipcController: DreamIpcController;
	// Renderer Signal IPC controller backed by the same Dream aggregate.
	private readonly signalIpcController: SignalIpcController;
	private readonly migration: DreamStorageMigration;
	private readonly workPaths: WorkStoragePaths;
	private readonly documents: LibraryService;

	// Creates the module from the operating system's documents directory.
	public constructor(documentsPath: string, internalPath: string, documents: LibraryService)
	{
		super();
		this.documents = documents;
		const rootPath = path.join(documentsPath, "Chora");
		const workPaths = new WorkStoragePaths(rootPath);
		this.workPaths = workPaths;
		const repository = new DreamRepository(workPaths);
		const signalRepository = new SignalRepository(rootPath, new SignalMarkdownCodec(), workPaths);
		const conversations = new ChatRepository(path.join(internalPath, "Conversations"));
		const trashPath = path.join(internalPath, "Trash", "DreamBundles");
		this.migration = new DreamStorageMigration(rootPath, internalPath, workPaths);
		const library = new DreamLibrary(rootPath, repository, signalRepository, documents, workPaths, conversations, trashPath);
		this.service = new DreamService(library);
		this.ipcController = new DreamIpcController(this.service);
		this.signalIpcController = new SignalIpcController(this.service);
	}

	// Completes storage migration before any reader catalogue can be opened.
	public async PrepareAsync(): Promise<void>
	{
		const works = await this.documents.ListAsync();
		this.workPaths.Initialize(works);
		await this.migration.RunAsync();
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
		this.signalIpcController.Register();
	}

	// Removes the Dreams IPC boundary.
	protected StopCore(): void
	{
		this.signalIpcController.Unregister();
		this.ipcController.Unregister();
	}
}
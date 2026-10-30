import { ChatRepository } from "../chat/ChatRepository.js";
import { ChatService } from "../chat/ChatService.js";
import { ChatIpcController } from "../chat/ChatIpcController.js";
import { DreamDiscussionContext } from "./DreamDiscussionContext.js";
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

// Owns Dream library composition and IPC registration.
export class DreamModule extends ApplicationModule
{
	// Dream behavior backed by the Dream persistence root.
	private readonly service: DreamService;
	// Reusable Chat boundary integrated with Dream canonical context.
	private readonly chat: ChatIpcController;
	// Renderer Dream IPC controller owned by this module.
	private readonly ipcController: DreamIpcController;
	// Renderer Signal IPC controller backed by the same Dream aggregate.
	private readonly signalIpcController: SignalIpcController;

	// Creates the module from the operating system's documents directory.
	public constructor(documentsPath: string, documents: LibraryService)
	{
		super();
		const rootPath = path.join(documentsPath, "Chora");
		const primaryPath = path.join(documentsPath, "Chora", "Dreams");
		const repository = new DreamRepository(primaryPath);
		const signalRepository = new SignalRepository(rootPath, new SignalMarkdownCodec());
		const conversations = new ChatRepository(path.join(rootPath, "Conversations"));
		const library = new DreamLibrary(primaryPath, repository, signalRepository, documents, conversations);
		const context = new DreamDiscussionContext(library, documents);
		const chat = new ChatService(conversations, context, "dream-discussion");
		this.chat = new ChatIpcController(chat);
		this.service = new DreamService(library);
		this.ipcController = new DreamIpcController(this.service);
		this.signalIpcController = new SignalIpcController(this.service);
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
		this.chat.Register();
	}

	// Removes the Dreams IPC boundary.
	protected StopCore(): void
	{
		this.chat.Unregister();
		this.signalIpcController.Unregister();
		this.ipcController.Unregister();
	}
}
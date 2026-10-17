import path from "node:path";
import { ApplicationModule } from "../bootstrap/ApplicationModule.js";
import { PromptLoader } from "../prompts/PromptLoader.js";
import { CreateModelProvider } from "../models/ModelProviderFactory.js";
import { IdeaDiscovery } from "./IdeaDiscovery.js";
import { IdeaIpcController } from "./IdeaIpcController.js";
import { IdeaLibrary } from "./IdeaLibrary.js";
import { IdeaMarkdownCodec } from "./IdeaMarkdownCodec.js";
import { IdeaRepository } from "./IdeaRepository.js";
import type { SignalLibrary } from "../signals/SignalLibrary.js";

// Composes the main-process Idea feature and controls its IPC lifetime.
export class IdeaModule extends ApplicationModule
{
	// Owns the Idea IPC registrations for this module.
	private readonly ipcController: IdeaIpcController;

	// Creates the complete Idea feature from application-owned dependencies.
	public constructor(documentsPath: string, signals: SignalLibrary)
	{
		super();
		const rootPath = path.join(documentsPath, "Chora");
		const codec = new IdeaMarkdownCodec();
		const repository = new IdeaRepository(rootPath, codec);
		const library = new IdeaLibrary(repository, signals);
		const prompts = new PromptLoader();
		const model = CreateModelProvider();
		const discovery = new IdeaDiscovery(signals, prompts, model);
		this.ipcController = new IdeaIpcController(library, discovery);
	}

	// Registers the Idea IPC boundary.
	protected StartCore(): void
	{
		this.ipcController.Register();
	}

	// Removes the Idea IPC boundary.
	protected StopCore(): void
	{
		this.ipcController.Unregister();
	}
}

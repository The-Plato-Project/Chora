import path from "node:path";
import { ApplicationModule } from "../bootstrap/ApplicationModule.js";
import { SignalIpcController } from "./SignalIpcController.js";
import { SignalLibrary } from "./SignalLibrary.js";
import { SignalMarkdownCodec } from "./SignalMarkdownCodec.js";
import { SignalRepository } from "./SignalRepository.js";
import type { LibraryService } from "../library/LibraryService.js";

// Composes work-owned Signal persistence and IPC.
export class SignalModule extends ApplicationModule
{
	// Owns the Signal IPC lifecycle.
	private readonly ipcController: SignalIpcController;
	// Owns authoritative Signal use cases for collaborating modules.
	private readonly library: SignalLibrary;

	public constructor(documentsPath: string, documents: LibraryService)
	{
		super();
		const rootPath = path.join(documentsPath, "Chora");
		const legacyDreamPath = path.join(rootPath, "Dreams");
		const repository = new SignalRepository(rootPath, legacyDreamPath, new SignalMarkdownCodec());
		this.library = new SignalLibrary(repository, documents);
		this.ipcController = new SignalIpcController(this.library);
	}

	// Exposes authoritative Signal use cases to collaborating modules.
	public GetLibrary(): SignalLibrary
	{
		return this.library;
	}

	// Registers Signal IPC.
	protected StartCore(): void
	{
		this.ipcController.Register();
	}

	// Removes Signal IPC.
	protected StopCore(): void
	{
		this.ipcController.Unregister();
	}
}

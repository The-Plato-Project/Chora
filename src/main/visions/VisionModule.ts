import path from "node:path";
import { ApplicationModule } from "../bootstrap/ApplicationModule.js";
import type { LibraryService } from "../library/LibraryService.js";
import { WorkStoragePaths } from "../storage/WorkStoragePaths.js";
import { VisionIpcController } from "./VisionIpcController.js";
import { VisionRepository } from "./VisionRepository.js";
import { VisionService } from "./VisionService.js";
import { TextAnchorIpcController } from "../anchors/TextAnchorIpcController.js";
import { TextAnchorRepository } from "../anchors/TextAnchorRepository.js";
import { TextAnchorService } from "../anchors/TextAnchorService.js";

export class VisionModule extends ApplicationModule
{
	private readonly workPaths: WorkStoragePaths;
	private readonly ipcController: VisionIpcController;
	private readonly anchorIpcController: TextAnchorIpcController;
	// Existing owners shared with optional read-only evidence projections.
	private readonly service: VisionService;
	private readonly anchors: TextAnchorService;

	public constructor(documentsPath: string, private readonly documents: LibraryService)
	{
		super();
		this.workPaths = new WorkStoragePaths(path.join(documentsPath, "Chora"));
		const repository = new VisionRepository(this.workPaths);
		this.service = new VisionService(repository);
		this.ipcController = new VisionIpcController(this.service);
		this.anchors = new TextAnchorService(new TextAnchorRepository(this.workPaths), documents);
		this.anchorIpcController = new TextAnchorIpcController(this.anchors);
	}

	// Exposes use cases without exposing repositories or filesystem paths.
	public GetService(): VisionService
	{
		return this.service;
	}

	// Shares exact anchor validation with permitted evidence readers.
	public GetAnchors(): TextAnchorService
	{
		return this.anchors;
	}

	public async PrepareAsync(): Promise<void>
	{
		this.workPaths.Initialize(await this.documents.ListAsync());
	}

	protected StartCore(): void
	{
		this.ipcController.Register();
		this.anchorIpcController.Register();
	}

	protected StopCore(): void
	{
		this.anchorIpcController.Unregister();
		this.ipcController.Unregister();
	}
}

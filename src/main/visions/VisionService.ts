import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type {
	CreateVisionCommand,
	CreateVisionFolderCommand,
	DeleteVisionFolderCommand,
	MoveVisionCommand,
	UpdateVisionCommand,
	VisionCatalogueSnapshot,
	VisionFolderSnapshot,
	VisionSnapshot
} from "../../shared/visions/VisionTypes.js";
import { Vision } from "./Vision.js";
import type { VisionRepository } from "./VisionRepository.js";

export class VisionService
{
	private readonly visions = new Map<string, VisionSnapshot>();
	private readonly folders = new Map<string, VisionFolderSnapshot>();
	private loadPromise: Promise<void> | null = null;
	private mutation = Promise.resolve();

	public constructor(private readonly repository: VisionRepository)
	{
	}

	public async ListAsync(): Promise<VisionCatalogueSnapshot>
	{
		await this.EnsureLoadedAsync();
		const visions = [...this.visions.values()].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
		const folders = [...this.folders.values()].sort((first, second) => first.path.localeCompare(second.path));
		return { visions, folders };
	}

	public CreateAsync(command: CreateVisionCommand): Promise<VisionSnapshot>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			this.ValidateFolderPath(command.folderPath, true);
			this.RequireFolder(command.workId, command.folderPath);
			const vision = Vision.Create(command.workId, command.folderPath);
			await this.repository.SaveAsync(vision);
			this.visions.set(vision.id, vision);
			return vision;
		});
	}

	public CreateFolderAsync(command: CreateVisionFolderCommand): Promise<VisionFolderSnapshot>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			this.ValidateFolderPath(command.parentPath, true);
			this.ValidateFolderName(command.name);
			this.RequireFolder(command.workId, command.parentPath);
			const folderPath = command.parentPath.length === 0 ? command.name : `${command.parentPath}/${command.name}`;
			const key = this.FolderKey(command.workId, folderPath);
			if (this.folders.has(key))
				throw ApplicationError.Expected("conflict", "INVALID_VISION_COMMAND", `Vision folder already exists: ${folderPath}`);
			await this.repository.EnsureFolderAsync(command.workId, folderPath);
			const folder = this.CreateFolderSnapshot(command.workId, folderPath);
			this.folders.set(key, folder);
			return folder;
		});
	}

	public DeleteFolderAsync(command: DeleteVisionFolderCommand): Promise<void>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			this.ValidateFolderPath(command.folderPath, false);
			const key = this.FolderKey(command.workId, command.folderPath);
			if (!this.folders.has(key))
				throw ApplicationError.Expected("not-found", "INVALID_VISION_COMMAND", `Vision folder does not exist: ${command.folderPath}`);
			const childPrefix = `${command.folderPath}/`;
			const hasChild = [...this.folders.values()].some((folder) =>
				folder.workId === command.workId && folder.path.startsWith(childPrefix));
			const hasVision = [...this.visions.values()].some((vision) =>
				vision.workId === command.workId
				&& (vision.folderPath === command.folderPath || vision.folderPath.startsWith(childPrefix)));
			if (hasChild || hasVision)
				throw ApplicationError.Expected("conflict", "INVALID_VISION_COMMAND", "Vision folder must be empty before it can be deleted.");
			await this.repository.DeleteFolderAsync(command.workId, command.folderPath);
			this.folders.delete(key);
		});
	}

	public MoveAsync(command: MoveVisionCommand): Promise<VisionSnapshot>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			this.ValidateFolderPath(command.folderPath, true);
			const vision = this.visions.get(command.visionId);
			if (vision === undefined) throw ApplicationError.Expected("not-found", "INVALID_VISION_COMMAND", "The Vision no longer exists.");
			this.RequireFolder(vision.workId, command.folderPath);
			if (vision.folderPath === command.folderPath) return vision;
			await this.repository.MoveAsync(vision, command.folderPath);
			const moved = { ...vision, folderPath: command.folderPath };
			this.visions.set(vision.id, moved);
			return moved;
		});
	}

	public UpdateAsync(command: UpdateVisionCommand): Promise<VisionSnapshot>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			const existing = this.visions.get(command.id);
			if (existing === undefined) throw new Error("The Vision no longer exists.");
			const vision = Vision.Update(existing, command);
			await this.repository.SaveAsync(vision);
			this.visions.set(vision.id, vision);
			return vision;
		});
	}

	public DeleteAsync(visionId: string): Promise<void>
	{
		return this.EnqueueAsync(async () =>
		{
			await this.EnsureLoadedAsync();
			const vision = this.visions.get(visionId);
			if (vision === undefined) throw new Error("The Vision no longer exists.");
			await this.repository.DeleteAsync(vision);
			this.visions.delete(visionId);
		});
	}

	private async EnsureLoadedAsync(): Promise<void>
	{
		if (this.loadPromise === null)
		{
			this.loadPromise = this.repository.LoadCatalogueAsync().then((catalogue) =>
			{
				for (const vision of catalogue.visions) this.visions.set(vision.id, vision);
				for (const folder of catalogue.folders) this.folders.set(this.FolderKey(folder.workId, folder.path), folder);
			});
		}
		await this.loadPromise;
	}

	private RequireFolder(workId: string, folderPath: string): void
	{
		if (folderPath.length > 0 && !this.folders.has(this.FolderKey(workId, folderPath)))
			throw ApplicationError.Expected("not-found", "INVALID_VISION_COMMAND", `Vision folder does not exist: ${folderPath}`);
	}

	private CreateFolderSnapshot(workId: string, folderPath: string): VisionFolderSnapshot
	{
		const segments = folderPath.split("/");
		return {
			workId,
			path: folderPath,
			name: segments[segments.length - 1]!,
			parentPath: segments.slice(0, -1).join("/")
		};
	}

	private FolderKey(workId: string, folderPath: string): string
	{
		return `${workId}\u0000${folderPath}`;
	}

	private ValidateFolderPath(folderPath: string, allowRoot: boolean): void
	{
		const segments = folderPath.length === 0 ? [] : folderPath.split("/");
		if ((!allowRoot && segments.length === 0) || segments.join("/") !== folderPath)
			throw ApplicationError.Expected("validation", "INVALID_VISION_COMMAND", "Vision folder path is invalid.");
		for (const segment of segments) this.ValidateFolderName(segment);
	}

	private ValidateFolderName(name: string): void
	{
		const invalid = name.length === 0 || name.length > 80 || name !== name.trim()
			|| name === "." || name === ".." || name.endsWith(".")
			|| /[<>:"/\\|?*\u0000-\u001f]/u.test(name);
		if (invalid) throw ApplicationError.Expected("validation", "INVALID_VISION_COMMAND", "Vision folder name is invalid.");
	}

	private EnqueueAsync<T>(operation: () => Promise<T>): Promise<T>
	{
		const result = this.mutation.then(operation, operation);
		this.mutation = result.then(() => undefined, () => undefined);
		return result;
	}
}

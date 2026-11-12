import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as DelayAsync } from "node:timers/promises";
import { Errors } from "../diagnostics/MainErrorManager.js";
import type { VisionCatalogueSnapshot, VisionFolderSnapshot, VisionSnapshot } from "../../shared/visions/VisionTypes.js";
import type { WorkStoragePaths } from "../storage/WorkStoragePaths.js";
import { VisionMarkdownCodec } from "./VisionMarkdownCodec.js";

export class VisionRepository
{
	public constructor(
		private readonly paths: WorkStoragePaths,
		private readonly codec = new VisionMarkdownCodec())
	{
	}

	public async LoadCatalogueAsync(): Promise<VisionCatalogueSnapshot>
	{
		const visions: VisionSnapshot[] = [];
		const folders: VisionFolderSnapshot[] = [];
		const identities = new Set<string>();

		for (const workId of this.paths.WorkIds())
		{
			const directory = this.paths.Resolve(workId, "Visions");
			await mkdir(directory, { recursive: true });
			const files = await this.ListAsync(workId, directory, directory, folders);
			for (const file of files)
			{
				const source = await readFile(file, "utf8");
				const relativeDirectory = path.relative(directory, path.dirname(file));
				const folderPath = relativeDirectory === "" ? "" : relativeDirectory.split(path.sep).join("/");
				const vision = this.codec.Decode(source, folderPath);
				if (vision.workId !== workId) throw new Error("A Vision is stored beneath the wrong work.");
				if (identities.has(vision.id)) throw new Error("Duplicate Vision identities were found.");
				identities.add(vision.id);
				visions.push(vision);
			}
		}

		visions.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
		folders.sort((first, second) => first.path.localeCompare(second.path));
		return { visions, folders };
	}

	public async SaveAsync(vision: VisionSnapshot): Promise<void>
	{
		const directory = this.ResolveDirectory(vision.workId, vision.folderPath);
		await mkdir(directory, { recursive: true });
		const destination = path.join(directory, `${vision.id}.md`);
		const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
		try
		{
			const encoded = this.codec.Encode(vision);
			await writeFile(temporary, encoded, "utf8");
			await this.ReplaceAsync(temporary, destination);
		}
		catch (error)
		{
			try
			{
				await rm(temporary, { force: true });
			}
			catch (cleanupError)
			{
				Errors.Error("VisionRepository.Cleanup", "Could not remove a temporary save file.", cleanupError);
			}
			throw error;
		}
	}

	// Windows file sharing can briefly deny replacement; retry only the same atomic rename.
	private async ReplaceAsync(temporary: string, destination: string): Promise<void>
	{
		const delays = [50, 150, 400];
		let retries = 0;
		let replaced = false;
		while (!replaced)
		{
			try
			{
				await rename(temporary, destination);
				replaced = true;
			}
			catch (error)
			{
				const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
				const delay = delays[retries];
				const retryable = process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(code);
				if (retryable && delay !== undefined)
				{
					await DelayAsync(delay);
					retries += 1;
				}
				else
				{
					throw error;
				}
			}
		}
		if (retries > 0) Errors.Info("VisionRepository", "Saved after a temporary Windows file-access failure.", { retries });
	}

	public async DeleteAsync(vision: VisionSnapshot): Promise<void>
	{
		const file = path.join(this.ResolveDirectory(vision.workId, vision.folderPath), `${vision.id}.md`);
		await rm(file);
	}

	public async EnsureFolderAsync(workId: string, folderPath: string): Promise<void>
	{
		await mkdir(this.ResolveDirectory(workId, folderPath), { recursive: true });
	}

	public async DeleteFolderAsync(workId: string, folderPath: string): Promise<void>
	{
		await rmdir(this.ResolveDirectory(workId, folderPath));
	}

	public async MoveAsync(vision: VisionSnapshot, folderPath: string): Promise<void>
	{
		const source = path.join(this.ResolveDirectory(vision.workId, vision.folderPath), `${vision.id}.md`);
		const destinationDirectory = this.ResolveDirectory(vision.workId, folderPath);
		await mkdir(destinationDirectory, { recursive: true });
		await rename(source, path.join(destinationDirectory, `${vision.id}.md`));
	}

	private ResolveDirectory(workId: string, folderPath: string): string
	{
		const root = this.paths.Resolve(workId, "Visions");
		const directory = folderPath.length === 0 ? root : path.resolve(root, ...folderPath.split("/"));
		const relative = path.relative(path.resolve(root), directory);
		if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
		{
			throw new Error("The Vision folder is outside its work storage root.");
		}
		return directory;
	}

	private async ListAsync(
		workId: string,
		root: string,
		directory: string,
		folders: VisionFolderSnapshot[]): Promise<string[]>
	{
		const entries: Dirent<string>[] = await readdir(directory, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries)
		{
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory())
			{
				const folderPath = path.relative(root, entryPath).split(path.sep).join("/");
				const segments = folderPath.split("/");
				folders.push({
					workId,
					path: folderPath,
					name: segments[segments.length - 1]!,
					parentPath: segments.slice(0, -1).join("/")
				});
				files.push(...await this.ListAsync(workId, root, entryPath, folders));
			}
			else if (entry.isFile() && path.extname(entry.name).toLocaleLowerCase() === ".md")
			{
				files.push(entryPath);
			}
		}
		return files;
	}
}

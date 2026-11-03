import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { ParseDreamMarkdown, SerializeDreamMarkdown } from "./DreamMarkdownCodec.js";
import { WorkStoragePaths } from "./WorkStoragePaths.js";

// A parsed Dream record together with its persistence path.
export interface DreamPersistenceRecord
{
	// Serialized Dream data owned by the Dream aggregate.
	readonly dream: DreamSnapshot;
	// Absolute path to the persisted Markdown record.
	readonly filePath: string;
}

// Loads and saves serialized Dream records without applying domain decisions.
export class DreamRepository
{
	// Creates persistence access scoped to one Dream library root.
	public constructor(private readonly workPaths: WorkStoragePaths)
	{
	}

	// Loads persisted records for the Dream library.
	public async LoadAsync(): Promise<DreamPersistenceRecord[]>
	{
		const records = new Map<string, DreamPersistenceRecord>();
		for (const workId of this.workPaths.WorkIds())
		{
			const workPath = this.workPaths.Resolve(workId, "Dreams");
			const paths = await this.ListMarkdownPathsAsync(workPath, true);
			for (const filePath of paths)
			{
				await this.LoadPathAsync(filePath, records);
			}
		}

		const loaded = [...records.values()];

		return loaded;
	}

	// Lists every reader-created folder relative to its work directory.
	public async LoadFolderPathsAsync(): Promise<readonly { readonly workId: string; readonly folderPath: string }[]>
	{
		const folders: { workId: string; folderPath: string }[] = [];
		for (const workId of this.workPaths.WorkIds())
		{
			const workPath = this.workPaths.Resolve(workId, "Dreams");
			try
			{
				await this.CollectFolderPathsAsync(workId, workPath, workPath, folders);
			}
			catch (error)
			{
				const code = this.GetErrorCode(error);
				if (code !== "ENOENT") throw error;
			}
		}

		return folders;
	}

	// Creates one validated folder selected by the owning DreamLibrary.
	public async CreateFolderAsync(folderPath: string): Promise<void>
	{
		const parentPath = path.dirname(folderPath);
		await mkdir(parentPath, { recursive: true });
		await mkdir(folderPath);
	}

	// Deletes one empty folder selected by the owning DreamLibrary.
	public async DeleteFolderAsync(folderPath: string): Promise<void>
	{
		await rmdir(folderPath);
	}

	// Writes a record at the path chosen by the owning DreamLibrary.
	public async SaveAsync(record: DreamPersistenceRecord, previousFilePath: string | null = null): Promise<void>
	{
		const content = SerializeDreamMarkdown(record.dream);

		await this.WriteAsync(record.filePath, content);
		if (previousFilePath !== null && !this.AreSamePath(previousFilePath, record.filePath))
		{
			try
			{
				await unlink(previousFilePath);
			}
			catch (error)
			{
				const code = this.GetErrorCode(error);

				if (code !== "ENOENT")
				{
					await this.RollBackMovedSaveAsync(record.filePath);
					throw error;
				}
			}
		}
	}

	// Removes a canonical record only after its aggregate payload has been durably retained.
	public async DeleteAsync(record: DreamPersistenceRecord): Promise<void>
	{
		try
		{
			await unlink(record.filePath);
		}
		catch (error)
		{
			const code = this.GetErrorCode(error);
			if (code !== "ENOENT") throw error;
		}
	}

	// Reads and parses one Markdown file into a persistence record.
	private async LoadPathAsync(filePath: string, records: Map<string, DreamPersistenceRecord>): Promise<void>
	{
		try
		{
			const content = await readFile(filePath, "utf8");
			const parsed = ParseDreamMarkdown(content);
			if (parsed === null) throw new Error(`Invalid Dream Markdown: ${filePath}`);
			if (records.has(parsed.id)) throw new Error(`Duplicate Dream identifier: ${parsed.id}`);
			const record: DreamPersistenceRecord = {
				dream: parsed,
				filePath
			};
			records.set(parsed.id, record);
		}
		catch (error)
		{
			throw error;
		}
	}

	// Recursively finds Markdown records beneath one Dream library directory.
	private async ListMarkdownPathsAsync(directory: string, optional = false): Promise<string[]>
	{
		let entries: Dirent<string>[] = [];

		try
		{
			entries = await readdir(directory, { withFileTypes: true });
		}
		catch (error)
		{
			const code = this.GetErrorCode(error);

			const isOptionalRoot = code === "ENOENT" && optional;

			if (!isOptionalRoot)
			{
				throw error;
			}
		}

		const paths: string[] = [];

		for (const entry of entries)
		{
			const entryPath = path.join(directory, entry.name);

			if (entry.isDirectory())
			{
				const childPaths = await this.ListMarkdownPathsAsync(entryPath);
				paths.push(...childPaths);
			}
			else
			{
				const normalizedName = entry.name.toLocaleLowerCase();
				const isMarkdown = normalizedName.endsWith(".md");

				if (entry.isFile() && isMarkdown)
				{
					paths.push(entryPath);
				}
			}
		}

		return paths;
	}

	// Recursively records nested folders without exposing absolute paths.
	private async CollectFolderPathsAsync(
		workId: string,
		workPath: string,
		directoryPath: string,
		folders: { workId: string; folderPath: string }[]): Promise<void>
	{
		const entries = await readdir(directoryPath, { withFileTypes: true });

		for (const entry of entries)
		{
			if (entry.isDirectory())
			{
				const entryPath = path.join(directoryPath, entry.name);
				const relativePath = path.relative(workPath, entryPath);
				const folderPath = relativePath.split(path.sep).join("/");
				folders.push({ workId, folderPath });
				await this.CollectFolderPathsAsync(workId, workPath, entryPath, folders);
			}
		}
	}

	// Writes one Dream atomically through a temporary sibling file.
	private async WriteAsync(filePath: string, content: string): Promise<void>
	{
		const directoryPath = path.dirname(filePath);
		const temporaryPath = `${filePath}.tmp`;
		await mkdir(directoryPath, { recursive: true });
		await writeFile(temporaryPath, content, "utf8");
		await rename(temporaryPath, filePath);
	}

	// Compares two filesystem paths using platform-appropriate casing.
	private AreSamePath(first: string, second: string): boolean
	{
		const firstPath = path.resolve(first);
		const secondPath = path.resolve(second);
		let isSame = firstPath === secondPath;

		if (process.platform === "win32")
		{
			const normalizedFirst = firstPath.toLocaleLowerCase();
			const normalizedSecond = secondPath.toLocaleLowerCase();
			isSame = normalizedFirst === normalizedSecond;
		}

		return isSame;
	}

	// Removes a replacement file when the original Dream filename could not be retired.
	private async RollBackMovedSaveAsync(filePath: string): Promise<void>
	{
		try
		{
			await unlink(filePath);
		}
		catch (error)
		{
			Errors.Error("DreamRepository", `Unable to roll back renamed Dream file: ${filePath}`, error);
		}
	}

	// Extracts a Node filesystem error code without hiding the original failure.
	private GetErrorCode(error: unknown): string
	{
		let code = "";

		if (error instanceof Error && "code" in error)
		{
			const nodeError = error as NodeJS.ErrnoException;
			code = nodeError.code ?? "";
		}

		return code;
	}
}

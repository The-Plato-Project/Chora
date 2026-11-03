import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Signal } from "../signals/Signal.js";
import { SignalMarkdownCodec } from "../signals/SignalMarkdownCodec.js";
import { WorkStoragePaths } from "./WorkStoragePaths.js";
import { ParseDreamMarkdown } from "./DreamMarkdownCodec.js";
import { Dream } from "./Dream.js";

interface MigrationFile
{
	readonly source: string;
	readonly destination: string;
	readonly original: Buffer;
	readonly content: Buffer;
}

// Moves the former storage layout only after retaining and checking every source file.
export class DreamStorageMigration
{
	private readonly files: MigrationFile[] = [];
	private readonly directories: string[] = [];
	private readonly destinationDirectories: string[] = [];
	private readonly codec = new SignalMarkdownCodec();

	public constructor(
		private readonly root: string,
		private readonly internal: string,
		private readonly works: WorkStoragePaths)
	{
	}

	public async RunAsync(): Promise<void>
	{
		await this.CollectDreamsAsync();
		await this.CollectSignalsAsync();
		await this.CollectTreeAsync(path.join(this.root, "Conversations"), path.join(this.internal, "Conversations"), false);
		await this.CollectTreeAsync(path.join(this.root, "Trash"), path.join(this.internal, "Trash"), true);

		const destinations = new Map<string, Buffer>();
		for (const file of this.files)
		{
			const key = path.resolve(file.destination).toLocaleLowerCase();
			const prior = destinations.get(key);
			if (prior !== undefined && !prior.equals(file.content)) throw new Error("Conflicting legacy reader files require manual recovery.");
			destinations.set(key, file.content);
			await this.AssertMatchingOrMissingAsync(file.destination, file.content);
			const backup = this.BackupPath(file.source);
			await this.AssertMatchingOrMissingAsync(backup, file.original);
		}

		for (const directory of this.destinationDirectories)
		{
			await mkdir(directory, { recursive: true });
		}
		for (const file of this.files)
		{
			const backup = this.BackupPath(file.source);
			await this.WriteExclusiveAsync(backup, file.original);
			await this.WriteExclusiveAsync(file.destination, file.content);
			const current = await readFile(file.source);
			if (!current.equals(file.original)) throw new Error("A reader file changed during migration. The backup has been retained.");
			await unlink(file.source);
		}

		for (const directory of this.directories)
		{
			try
			{
				await rmdir(directory);
			}
			catch (error)
			{
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
			}
		}
	}

	private async CollectDreamsAsync(): Promise<void>
	{
		const legacy = path.join(this.root, "Dreams");
		const entries = await this.ReadEntriesAsync(legacy);
		for (const entry of entries)
		{
			if (!entry.isDirectory()) throw new Error("Unexpected item in the former Dream library; no files were moved.");
			const destination = this.works.Resolve(entry.name, "Dreams");
			await this.CollectTreeAsync(path.join(legacy, entry.name), destination, false, entry.name);
		}
		this.directories.push(legacy);
	}

	private async CollectSignalsAsync(): Promise<void>
	{
		await this.CollectSignalDirectoryAsync(path.join(this.root, "Signals"), null);
		for (const workId of this.works.WorkIds())
		{
			const oldWork = path.join(this.root, workId);
			await this.CollectSignalDirectoryAsync(path.join(oldWork, "Signals"), workId);
			this.directories.push(oldWork);
		}
	}

	private async CollectSignalDirectoryAsync(directory: string, expectedWork: string | null): Promise<void>
	{
		const entries = await this.ReadEntriesAsync(directory);
		for (const entry of entries)
		{
			if (!entry.isFile() || !entry.name.endsWith(".md")) throw new Error("Unexpected item in the former Signal library; no files were moved.");
			const source = path.join(directory, entry.name);
			const original = await readFile(source);
			const record = this.codec.Parse(original.toString("utf8"));
			new Signal(record);
			if (entry.name !== `${record.id}.md` || (expectedWork !== null && expectedWork !== record.workId))
			{
				throw new Error("A legacy Signal identity does not match its location.");
			}
			const destination = path.join(this.works.Resolve(record.workId, "Signals"), entry.name);
			const sourcePath = path.resolve(source);
			const destinationPath = path.resolve(destination);
			const samePath = process.platform === "win32"
				? sourcePath.toLocaleLowerCase() === destinationPath.toLocaleLowerCase()
				: sourcePath === destinationPath;
			if (!samePath) this.files.push({ source, destination, original, content: original });
		}
		this.directories.push(directory);
	}

	private async CollectTreeAsync(source: string, destination: string, trash: boolean, dreamWork: string | null = null): Promise<void>
	{
		const entries = await this.ReadEntriesAsync(source);
		for (const entry of entries)
		{
			const child = path.join(source, entry.name);
			const target = path.join(destination, entry.name);
			if (entry.isDirectory())
			{
				this.destinationDirectories.push(target);
				await this.CollectTreeAsync(child, target, trash, dreamWork);
			}
			else if (entry.isFile())
			{
				const original = await readFile(child);
				let content: Buffer = original;
				if (dreamWork !== null && entry.name.toLocaleLowerCase().endsWith(".md"))
				{
					const dream = ParseDreamMarkdown(original.toString("utf8"));
					if (dream === null || dream.workId !== dreamWork) throw new Error("A legacy Dream is invalid or belongs to a different work.");
					new Dream(dream);
				}
				if (trash && path.basename(source) === "DreamBundles" && entry.name.endsWith(".json"))
				{
					content = this.RemapTrash(original);
				}
				this.files.push({ source: child, destination: target, original, content });
			}
			else
			{
				throw new Error("A legacy storage location contains a symbolic link or unsupported item.");
			}
		}
		if (entries.length > 0) this.destinationDirectories.push(destination);
		this.directories.push(source);
	}

	private RemapTrash(original: Buffer): Buffer
	{
		const record: unknown = JSON.parse(original.toString("utf8"));
		if (typeof record !== "object" || record === null || !("dream" in record) || !("relativePath" in record))
		{
			throw new Error("A retained Dream Trash record is invalid.");
		}
		const value = record as { dream: { workId?: unknown }; relativePath: unknown };
		if (typeof value.dream?.workId !== "string" || typeof value.relativePath !== "string" || path.isAbsolute(value.relativePath))
		{
			throw new Error("A retained Dream Trash location is invalid.");
		}
		const segments = value.relativePath.split(/[\\/]/u);
		if (segments.length < 2 || segments[0] !== value.dream.workId
			|| segments.some(function IsUnsafe(segment): boolean { return segment === "" || segment === "." || segment === ".."; }))
		{
			throw new Error("A retained Dream Trash location is outside its work.");
		}
		const destination = path.join(this.works.Resolve(value.dream.workId, "Dreams"), ...segments.slice(1));
		value.relativePath = path.relative(this.root, destination);
		const content = Buffer.from(JSON.stringify(value), "utf8");

		return content;
	}

	private async ReadEntriesAsync(directory: string): Promise<import("node:fs").Dirent<string>[]>
	{
		let entries: import("node:fs").Dirent<string>[] = [];
		try
		{
			entries = await readdir(directory, { withFileTypes: true });
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return entries;
	}

	private BackupPath(source: string): string
	{
		const relative = path.relative(this.root, source);
		if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
		{
			throw new Error("Migration source is outside the reader library.");
		}
		const backup = path.join(this.internal, "StorageMigrationBackup", relative);
		return backup;
	}

	private async AssertMatchingOrMissingAsync(file: string, content: Buffer): Promise<void>
	{
		try
		{
			const existing = await readFile(file);
			if (!existing.equals(content)) throw new Error("A destination or backup conflicts with reader data. No conflicting file was overwritten.");
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	private async WriteExclusiveAsync(file: string, content: Buffer): Promise<void>
	{
		await mkdir(path.dirname(file), { recursive: true });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try
		{
			await writeFile(temporary, content, { flag: "wx" });
			await link(temporary, file);
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await readFile(file);
			if (!existing.equals(content)) throw new Error("A destination or backup conflicts with reader data. No conflicting file was overwritten.");
		}
		finally
		{
			try
			{
				await unlink(temporary);
			}
			catch (error)
			{
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
}

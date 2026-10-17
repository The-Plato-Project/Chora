import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import matter from "gray-matter";
import type { SignalRecord } from "../../shared/signals/SignalTypes.js";
import { SignalMarkdownCodec } from "./SignalMarkdownCodec.js";

// Reads the former denormalized selection text only while importing legacy files.
function ReadLegacySelectedText(selection: SignalRecord["selection"]): string
{
	const legacy = selection as SignalRecord["selection"] & { selectedText?: unknown };
	const text = typeof legacy.selectedText === "string" ? legacy.selectedText : "";

	return text;
}

// Owns canonical Signal files and imports legacy Dream-embedded Signals.
export class SignalRepository
{
	public constructor(
		private readonly rootPath: string,
		private readonly legacyDreamPath: string,
		private readonly codec: SignalMarkdownCodec)
	{
	}

	// Loads canonical Signals and any legacy Dream-embedded Signals not yet migrated.
	public async LoadAsync(): Promise<SignalRecord[]>
	{
		const records = await this.LoadCanonicalAsync();
		const knownIds = new Set(records.map(function SelectId(signal): string
		{
			return signal.id;
		}));
		const legacy = await this.LoadLegacyAsync();

		for (const signal of legacy)
		{
			if (!knownIds.has(signal.id))
			{
				knownIds.add(signal.id);
				records.push(signal);
				await this.SaveAsync(signal);
			}
		}

		return records;
	}

	// Saves one Signal at its canonical work-owned path.
	public async SaveAsync(signal: SignalRecord): Promise<void>
	{
		const directoryPath = path.resolve(this.rootPath, signal.workId, "Signals");
		const filePath = path.resolve(directoryPath, `${signal.id}.md`);
		this.AssertInsideRoot(filePath);
		const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
		const content = this.codec.Serialize(signal);
		await mkdir(directoryPath, { recursive: true });
		await writeFile(temporaryPath, content, "utf8");

		try
		{
			await this.RenameWithRetryAsync(temporaryPath, filePath);
		}
		catch (error)
		{
			await this.DeleteTemporaryAsync(temporaryPath, error);
		}
	}

	// Deletes one canonical Signal file.
	public async DeleteAsync(signal: SignalRecord): Promise<void>
	{
		const filePath = path.resolve(this.rootPath, signal.workId, "Signals", `${signal.id}.md`);
		this.AssertInsideRoot(filePath);

		try
		{
			await unlink(filePath);
		}
		catch (error)
		{
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") throw error;
		}
	}

	// Determines whether any persisted Dream or Idea still references one Signal.
	public async IsAssociatedAsync(signalId: string): Promise<boolean>
	{
		const files = await this.CollectMarkdownFilesAsync(this.rootPath);
		let associated = false;

		for (const filePath of files)
		{
			const isSignalFile = filePath.includes(`${path.sep}Signals${path.sep}`);

			if (!isSignalFile)
			{
				const content = await readFile(filePath, "utf8");
				const data = matter(content).data as Record<string, unknown>;
				associated = this.ContainsSignal(data, signalId);
				if (associated) break;
			}
		}

		return associated;
	}

	// Loads canonical Signal Markdown files.
	private async LoadCanonicalAsync(): Promise<SignalRecord[]>
	{
		const records: SignalRecord[] = [];
		const workEntries = await this.ReadEntriesAsync(this.rootPath);

		for (const workEntry of workEntries)
		{
			if (workEntry.isDirectory())
			{
				const signalPath = path.join(this.rootPath, workEntry.name, "Signals");
				const entries = await this.ReadEntriesAsync(signalPath);

				for (const entry of entries)
				{
					if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md"))
					{
						const content = await readFile(path.join(signalPath, entry.name), "utf8");
						records.push(this.codec.Parse(content));
					}
				}
			}
		}

		return records;
	}

	// Imports Signals embedded in the previous Dream persistence format.
	private async LoadLegacyAsync(): Promise<SignalRecord[]>
	{
		const records: SignalRecord[] = [];
		const workEntries = await this.ReadEntriesAsync(this.legacyDreamPath);

		for (const workEntry of workEntries)
		{
			if (workEntry.isDirectory())
			{
				const dreamPath = path.join(this.legacyDreamPath, workEntry.name);
				const entries = await this.ReadEntriesAsync(dreamPath);

				for (const entry of entries)
				{
					if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md"))
					{
						const content = await readFile(path.join(dreamPath, entry.name), "utf8");
						const data = matter(content).data as Record<string, unknown>;
						const workId = typeof data.workId === "string" ? data.workId : workEntry.name;
						const timestamp = typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString();
						const signals = Array.isArray(data.signals) ? data.signals : [];

						for (const candidate of signals)
						{
							const signal = this.ParseLegacySignal(candidate, workId, timestamp);
							if (signal !== null) records.push(signal);
						}

					}
				}
			}
		}

		return records;
	}

	// Recursively collects persisted Markdown documents under Chora's data root.
	private async CollectMarkdownFilesAsync(directoryPath: string): Promise<string[]>
	{
		const files: string[] = [];
		const entries = await this.ReadEntriesAsync(directoryPath);

		for (const entry of entries)
		{
			const entryPath = path.join(directoryPath, entry.name);

			if (entry.isDirectory())
			{
				const nested = await this.CollectMarkdownFilesAsync(entryPath);
				files.push(...nested);
			}
			else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".md"))
			{
				files.push(entryPath);
			}
		}

		return files;
	}

	// Recognizes current and legacy Signal association metadata.
	private ContainsSignal(data: Record<string, unknown>, signalId: string): boolean
	{
		const signalIds = Array.isArray(data.signalIds) ? data.signalIds : [];
		const legacySignals = Array.isArray(data.signals) ? data.signals : [];
		const relatedSignals = Array.isArray(data.relatedSignals) ? data.relatedSignals : [];
		const references = Array.isArray(data.references) ? data.references : [];
		const candidates = [data.originSignal, ...relatedSignals, ...references, ...legacySignals];
		let contains = false;

		for (const candidate of signalIds)
		{
			if (candidate === signalId) contains = true;
		}

		for (const candidate of candidates)
		{
			if (typeof candidate === "object" && candidate !== null && (candidate as Record<string, unknown>).signalId === signalId)
			{
				contains = true;
			}
			if (typeof candidate === "object" && candidate !== null && (candidate as Record<string, unknown>).id === signalId)
			{
				contains = true;
			}
		}

		return contains;
	}

	// Converts one legacy embedded Signal when its required fields are intact.
	private ParseLegacySignal(candidate: unknown, workId: string, timestamp: string): SignalRecord | null
	{
		let signal: SignalRecord | null = null;

		if (typeof candidate === "object" && candidate !== null)
		{
			const value = candidate as Record<string, unknown>;
			const selection = value.selection;

			if (typeof value.id === "string" && typeof selection === "object" && selection !== null)
			{
				const typedSelection = selection as SignalRecord["selection"];
				signal = {
					id: value.id,
					workId,
					sourceRef: typeof value.sourceRef === "string" ? value.sourceRef : typedSelection.start.segmentKey,
					selection: typedSelection,
					text: typeof value.text === "string"
						? value.text
						: ReadLegacySelectedText(typedSelection),
					description: typeof value.description === "string" ? value.description : "",
					createdAt: timestamp,
					updatedAt: timestamp
				};
			}
		}

		return signal;
	}

	// Reads one optional directory.
	private async ReadEntriesAsync(directoryPath: string): Promise<Dirent<string>[]>
	{
		let entries: Dirent<string>[] = [];

		try
		{
			entries = await readdir(directoryPath, { withFileTypes: true });
		}
		catch (error)
		{
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") throw error;
		}

		return entries;
	}

	// Proves that a canonical Signal path remains under Chora's data root.
	private AssertInsideRoot(filePath: string): void
	{
		const relativePath = path.relative(path.resolve(this.rootPath), filePath);

		if (relativePath.length === 0 || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath))
		{
			throw new Error("Signal persistence path is outside the Chora data root");
		}
	}

	// Retries atomic replacement when Windows or OneDrive briefly locks the destination.
	private async RenameWithRetryAsync(temporaryPath: string, filePath: string): Promise<void>
	{
		const delays = [25, 50, 100, 200, 400];
		let renamed = false;
		let lastError: unknown = null;

		for (let attempt = 0; attempt <= delays.length && !renamed; attempt += 1)
		{
			try
			{
				await rename(temporaryPath, filePath);
				renamed = true;
			}
			catch (error)
			{
				lastError = error;
				const canRetry = attempt < delays.length && this.IsTransientRenameError(error);

				if (canRetry)
				{
					await this.DelayAsync(delays[attempt]!);
				}
				else
				{
					throw error;
				}
			}
		}

		if (!renamed)
		{
			throw lastError;
		}
	}

	// Identifies filesystem errors caused by temporary Windows or synchronization locks.
	private IsTransientRenameError(error: unknown): boolean
	{
		const code = (error as NodeJS.ErrnoException).code;
		const transient = code === "EACCES" || code === "EBUSY" || code === "EPERM";

		return transient;
	}

	// Waits before retrying a transient atomic replacement.
	private DelayAsync(delay: number): Promise<void>
	{
		const completion = new Promise<void>(function CompleteAfterDelay(resolve): void
		{
			setTimeout(resolve, delay);
		});

		return completion;
	}

	// Removes a failed temporary write and preserves both failures when cleanup also fails.
	private async DeleteTemporaryAsync(temporaryPath: string, saveError: unknown): Promise<never>
	{
		try
		{
			await unlink(temporaryPath);
		}
		catch (cleanupError)
		{
			const code = (cleanupError as NodeJS.ErrnoException).code;

			if (code !== "ENOENT")
			{
				throw new AggregateError([saveError, cleanupError], "Unable to save or clean up the temporary Signal file");
			}
		}

		throw saveError;
	}
}

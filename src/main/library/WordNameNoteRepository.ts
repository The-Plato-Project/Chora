import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordNameNote, WordNameNoteKey } from "../../shared/library/WordExplorationTypes.js";

interface NameNoteFile
{
	readonly version: 1;
	readonly notes: readonly WordNameNote[];
}

export class WordNameNoteRepository
{
	private readonly filePath: string;
	private writeBarrier: Promise<void> = Promise.resolve();

	public constructor(rootPath: string)
	{
		this.filePath = path.resolve(rootPath, "word-name-notes-v1.json");
	}

	public async GetAsync(key: WordNameNoteKey): Promise<WordNameNote>
	{
		await this.writeBarrier;
		const file = await this.LoadAsync();
		const note = file.notes.find((item) => this.Matches(item, key));
		return note ?? { ...key, text: "" };
	}

	public async SaveAsync(note: WordNameNote): Promise<WordNameNote>
	{
		let release = function UninitializedRelease(): void {};
		const previous = this.writeBarrier;
		this.writeBarrier = new Promise<void>(function CreateBarrier(resolve): void
		{
			release = resolve;
		});
		await previous;
		try
		{
			const file = await this.LoadAsync();
			const notes = file.notes.filter((item) => !this.Matches(item, note));
			if (note.text.length > 0) notes.push(note);
			await this.WriteAsync({ version: 1, notes });
			return note;
		}
		finally
		{
			release();
		}
	}

	private async LoadAsync(): Promise<NameNoteFile>
	{
		let content: string;
		try
		{
			content = await readFile(this.filePath, "utf8");
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
			{
				return { version: 1, notes: [] };
			}
			throw error;
		}
		const value = JSON.parse(content) as unknown;
		if (!this.IsNameNoteFile(value))
		{
			throw new Error("Word name note storage is invalid.");
		}
		return value;
	}

	private async WriteAsync(file: NameNoteFile): Promise<void>
	{
		const directory = path.dirname(this.filePath);
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
		await mkdir(directory, { recursive: true });
		await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
		try
		{
			await rename(temporaryPath, this.filePath);
		}
		catch (error)
		{
			try
			{
				await unlink(temporaryPath);
			}
			catch (cleanupError)
			{
				throw new AggregateError(
					[error, cleanupError],
					"Word name note save and cleanup failed.");
			}
			throw error;
		}
	}

	private Matches(left: WordNameNoteKey, right: WordNameNoteKey): boolean
	{
		return left.dialogue === right.dialogue && left.lemma === right.lemma;
	}

	private IsNameNoteFile(value: unknown): value is NameNoteFile
	{
		if (value === null || typeof value !== "object") return false;
		const file = value as Partial<NameNoteFile>;
		if (file.version !== 1 || !Array.isArray(file.notes)) return false;
		return file.notes.every(function IsNameNote(item): item is WordNameNote
		{
			return item !== null && typeof item === "object"
				&& typeof (item as WordNameNote).dialogue === "string"
				&& typeof (item as WordNameNote).lemma === "string"
				&& typeof (item as WordNameNote).text === "string";
		});
	}
}

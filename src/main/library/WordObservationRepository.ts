import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WordObservation, WordObservationKey } from "../../shared/library/WordExplorationTypes.js";

interface ObservationFile
{
	readonly version: 1;
	readonly observations: readonly WordObservation[];
}

export class WordObservationRepository
{
	private readonly filePath: string;
	private writeBarrier: Promise<void> = Promise.resolve();

	public constructor(rootPath: string)
	{
		this.filePath = path.resolve(rootPath, "word-observations-v1.json");
	}

	public async GetAsync(key: WordObservationKey): Promise<WordObservation>
	{
		await this.writeBarrier;
		const file = await this.LoadAsync();
		const observation = file.observations.find((item) => this.Matches(item, key));
		return observation ?? { ...key, text: "" };
	}

	public async SaveAsync(observation: WordObservation): Promise<WordObservation>
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
			const observations = file.observations.filter((item) => !this.Matches(item, observation));
			if (observation.text.length > 0) observations.push(observation);
			await this.WriteAsync({ version: 1, observations });
			return observation;
		}
		finally
		{
			release();
		}
	}

	private async LoadAsync(): Promise<ObservationFile>
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
				return { version: 1, observations: [] };
			}
			throw error;
		}
		const value = JSON.parse(content) as unknown;
		if (!this.IsObservationFile(value))
		{
			throw new Error("Word observation storage is invalid.");
		}
		return value;
	}

	private async WriteAsync(file: ObservationFile): Promise<void>
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
				throw new AggregateError([error, cleanupError], "Word observation save and cleanup failed.");
			}
			throw error;
		}
	}

	private Matches(left: WordObservationKey, right: WordObservationKey): boolean
	{
		return left.dialogue === right.dialogue
			&& left.textVersion === right.textVersion
			&& left.lemma === right.lemma;
	}

	private IsObservationFile(value: unknown): value is ObservationFile
	{
		if (value === null || typeof value !== "object") return false;
		const file = value as Partial<ObservationFile>;
		if (file.version !== 1 || !Array.isArray(file.observations)) return false;
		return file.observations.every(function IsObservation(item): item is WordObservation
		{
			return item !== null && typeof item === "object"
				&& typeof (item as WordObservation).dialogue === "string"
				&& typeof (item as WordObservation).textVersion === "string"
				&& /^sha256:[0-9a-f]{64}$/u.test((item as WordObservation).textVersion)
				&& typeof (item as WordObservation).lemma === "string"
				&& typeof (item as WordObservation).text === "string";
		});
	}
}

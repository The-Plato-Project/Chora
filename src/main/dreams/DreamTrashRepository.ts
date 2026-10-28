import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import type { SignalRepository } from "../signals/SignalRepository.js";
import { Errors } from "../diagnostics/MainErrorManager.js";
import { Signal } from "../signals/Signal.js";
import { Dream } from "./Dream.js";
import type { DreamPersistenceRecord, DreamRepository } from "./DreamRepository.js";

// Durable aggregate payload and operation state; paths are always relative to the Dream root.
interface TrashRecord
{
	// Unique deletion identity, independent of the Dream identity.
	readonly id: string;
	// Complete aggregate retained until restore or explicit permanent removal.
	readonly dream: DreamSnapshot;
	// Original Markdown location relative to the owning Dream root.
	readonly relativePath: string;
	// Original deletion timestamp.
	readonly deletedAt: string;
	// Durable intent replayed before the live catalogue is loaded.
	readonly state: "deleting" | "trashed" | "restoring";
}

// Owns recoverable aggregate payloads and replay of interrupted cross-repository operations.
export class DreamTrashRepository
{
	// Stores one atomic aggregate record for each deletion; legacy Markdown trash remains untouched.
	private readonly trashPath: string;

	// Creates the journal beside the Dream library, sharing its canonical repositories.
	public constructor(
		private readonly primaryPath: string,
		private readonly dreams: DreamRepository,
		private readonly signals: SignalRepository)
	{
		this.trashPath = path.join(path.dirname(primaryPath), "Trash", "DreamBundles");
	}

	// Commits deletion intent before any live file is removed.
	public async StageAsync(persistence: DreamPersistenceRecord, dream: DreamSnapshot): Promise<string>
	{
		const relativePath = path.relative(this.primaryPath, persistence.filePath);
		const record: TrashRecord = { id: randomUUID(), dream, relativePath, deletedAt: new Date().toISOString(), state: "deleting" };
		this.ValidateRecord(record);
		await this.WriteAsync(record);
		const id = record.id;

		return id;
	}

	// Finishes all durable intents before loading the canonical Dream and Signal catalogues.
	public async RecoverAsync(): Promise<void>
	{
		const records = await this.ReadAllAsync();
		for (const record of records)
		{
			if (record.state === "deleting") await this.FinishDeletionAsync(record.id);
			else if (record.state === "restoring") await this.RestoreAsync(record.id);
		}
	}

	// Retires canonical files idempotently while the complete payload remains recoverable.
	public async FinishDeletionAsync(id: string): Promise<void>
	{
		const record = await this.ReadAsync(id);
		if (record.state === "restoring") throw new Error("This Dream is being restored. Retry Restore or restart Chora.");
		if (record.state === "deleting")
		{
			const filePath = this.ResolveOriginalPath(record);
			await this.dreams.DeleteAsync({ dream: record.dream, filePath });
			for (const signal of record.dream.signals) await this.signals.DeleteAsync(signal);
			await this.WriteAsync({ ...record, state: "trashed" });
		}
	}

	// Lists retained records without exposing filesystem paths or aggregate mutation inputs.
	public async ListAsync(): Promise<readonly DreamTrashSnapshot[]>
	{
		const records = await this.ReadAllAsync();
		const snapshots: DreamTrashSnapshot[] = [];
		for (const record of records)
		{
			snapshots.push({ id: record.id, dreamId: record.dream.id, workId: record.dream.workId,
				title: record.dream.title, deletedAt: record.deletedAt, signalCount: record.dream.signals.length,
				restoring: record.state === "restoring" });
		}
		snapshots.sort(function NewestFirst(first, second): number
		{
			const comparison = second.deletedAt.localeCompare(first.deletedAt);
			return comparison;
		});

		return snapshots;
	}

	// Restores Signals first and their owning Dream last; retries replay the same payload.
	public async RestoreAsync(id: string): Promise<DreamPersistenceRecord>
	{
		await this.PrepareRestoreAsync(id);
		const record = await this.ReadAsync(id);
		for (const signal of record.dream.signals) await this.signals.SaveAsync(signal);
		const filePath = this.ResolveOriginalPath(record);
		const persistence = { dream: record.dream, filePath };
		await this.dreams.SaveAsync(persistence);
		const trashFile = this.ResolveTrashPath(id);
		await unlink(trashFile);

		return persistence;
	}

	// Permanently removes only a settled aggregate payload after completing live-file cleanup.
	public async PurgeAsync(id: string): Promise<void>
	{
		await this.FinishDeletionAsync(id);
		const trashFile = this.ResolveTrashPath(id);
		await unlink(trashFile);
	}

	// Records restore intent only after deletion cleanup has completed.
	private async PrepareRestoreAsync(id: string): Promise<void>
	{
		let record = await this.ReadAsync(id);
		if (record.state !== "restoring")
		{
			await this.FinishDeletionAsync(id);
			record = await this.ReadAsync(id);
			await this.WriteAsync({ ...record, state: "restoring" });
		}
	}

	// Reads only committed aggregate records; temporary siblings never become visible.
	private async ReadAllAsync(): Promise<TrashRecord[]>
	{
		await mkdir(this.trashPath, { recursive: true });
		const entries = await readdir(this.trashPath, { withFileTypes: true });
		const records: TrashRecord[] = [];
		for (const entry of entries)
		{
			if (entry.isFile() && entry.name.endsWith(".json"))
			{
				const id = entry.name.slice(0, -5);
				const record = await this.ReadAsync(id);
				records.push(record);
			}
			else if (entry.isFile() && /^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/u.test(entry.name))
			{
				const temporaryPath = path.join(this.trashPath, entry.name);
				await unlink(temporaryPath);
			}
		}

		return records;
	}

	// Validates persisted metadata before it can influence canonical filesystem operations.
	private async ReadAsync(id: string): Promise<TrashRecord>
	{
		const filePath = this.ResolveTrashPath(id);
		const content = await readFile(filePath, "utf8");
		const record = JSON.parse(content) as TrashRecord;
		this.ValidateRecord(record);
		if (record.id !== id) throw new Error("Trash identity does not match its file.");

		return record;
	}

	// Atomically commits an operation payload or a later state transition.
	private async WriteAsync(record: TrashRecord): Promise<void>
	{
		await mkdir(this.trashPath, { recursive: true });
		const destination = this.ResolveTrashPath(record.id);
		const temporaryPath = `${destination}.${randomUUID()}.tmp`;
		const content = JSON.stringify(record);
		try
		{
			await writeFile(temporaryPath, content, "utf8");
			await rename(temporaryPath, destination);
		}
		finally
		{
			try
			{
				await unlink(temporaryPath);
			}
			catch (error)
			{
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ENOENT") Errors.Error("DreamTrashRepository", "Unable to clean a temporary Trash payload.", error);
			}
		}
	}

	// Rejects unsafe renderer identifiers before any filesystem access.
	private ResolveTrashPath(id: string): string
	{
		if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id))
		{
			throw new Error("Trash identifier is invalid.");
		}
		const filePath = path.join(this.trashPath, `${id}.json`);

		return filePath;
	}

	// Proves the recorded location remains within the Dream's own work directory.
	private ResolveOriginalPath(record: TrashRecord): string
	{
		if (typeof record.relativePath !== "string" || path.isAbsolute(record.relativePath)) throw new Error("Trash location is invalid.");
		const workRoot = path.resolve(this.primaryPath, record.dream.workId);
		const filePath = path.resolve(this.primaryPath, record.relativePath);
		const relative = path.relative(workRoot, filePath);
		if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.extname(filePath) !== ".md")
		{
			throw new Error("Trash location is outside its owning work.");
		}

		return filePath;
	}

	// Reuses aggregate validation before a retained payload is restored or removed.
	private ValidateRecord(record: TrashRecord): void
	{
		this.ResolveTrashPath(record.id);
		if (!["deleting", "trashed", "restoring"].includes(record.state) || !Number.isFinite(Date.parse(record.deletedAt)))
		{
			throw new Error("Trash metadata is invalid.");
		}
		const dream = new Dream(record.dream);
		dream.ToSnapshot();
		for (const recordSignal of record.dream.signals)
		{
			new Signal(recordSignal);
		}
		this.ResolveOriginalPath(record);
	}
}

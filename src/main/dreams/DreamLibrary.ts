import path from "node:path";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { Dream } from "./Dream.js";
import { DreamRepository, type DreamPersistenceRecord } from "./DreamRepository.js";
import type { SignalLibrary } from "../signals/SignalLibrary.js";

// Owns Dreams loaded into this reader's Dream library.
export class DreamLibrary
{
	// Primary root used for all reader-owned writes.
	private readonly primaryPath: string;
	// Persistence collaborator for serialized Dream records.
	private readonly repository: DreamRepository;
	// Aggregates keyed by their stable Dream identity.
	private readonly dreams = new Map<string, Dream>();
	// Persistence metadata keyed by Dream identity.
	private readonly records = new Map<string, DreamPersistenceRecord>();
	// Tracks whether persistence records have been read for this application run.
	private isLoaded = false;

	// Creates a Dream aggregate root backed by the provided Dream library.
	public constructor(primaryPath: string, repository: DreamRepository, private readonly signals: SignalLibrary)
	{
		this.primaryPath = primaryPath;
		this.repository = repository;
	}

	// Lists immutable records for every Dream visible to the reader.
	public async ListAsync(): Promise<DreamSnapshot[]>
	{
		await this.EnsureLoadedAsync();
		const dreams: DreamSnapshot[] = [];

		for (const dream of this.dreams.values())
		{
			const snapshot = dream.ToSnapshot();
			dreams.push(snapshot);
		}

		return dreams;
	}

	// Normalizes and saves one Dream while retaining existing ownership metadata.
	public async SaveAsync(snapshot: DreamSnapshot): Promise<DreamSnapshot>
	{
		await this.EnsureLoadedAsync();
		const existing = this.dreams.get(snapshot.id);
		const previousSignalIds = existing?.ToSnapshot().signalIds ?? [];
		const normalizedSnapshot = this.CreateSaveSnapshot(snapshot, existing);
		const dream = new Dream(normalizedSnapshot);
		const existingPersistence = this.records.get(dream.GetId());
		const persistence = this.CreatePersistenceRecord(dream);
		const previousFilePath = existingPersistence?.filePath ?? null;

		await this.repository.SaveAsync(persistence, previousFilePath);
		this.dreams.set(dream.GetId(), dream);
		this.records.set(dream.GetId(), persistence);
		const saved = dream.ToSnapshot();

		for (const signalId of previousSignalIds)
		{
			if (!saved.signalIds.includes(signalId))
			{
				await this.signals.DeleteIfOrphanedAsync(signalId);
			}
		}

		return saved;
	}

	// Deletes a Dream record from the primary library.
	public async DeleteAsync(dreamId: string): Promise<void>
	{
		await this.EnsureLoadedAsync();
		this.ValidateIdentifier(dreamId, "Dream identifier");
		const persistence = this.records.get(dreamId);

		if (persistence !== undefined)
		{
			const signalIds = this.dreams.get(dreamId)?.ToSnapshot().signalIds ?? [];
			await this.repository.DeleteAsync(persistence);
			this.dreams.delete(dreamId);
			this.records.delete(dreamId);

			for (const signalId of signalIds) await this.signals.DeleteIfOrphanedAsync(signalId);
		}
	}

	// Removes one Signal association from every persisted Dream.
	public async RemoveSignalEverywhereAsync(signalId: string): Promise<void>
	{
		await this.EnsureLoadedAsync();

		for (const [dreamId, dream] of this.dreams)
		{
			const snapshot = dream.ToSnapshot();

			if (snapshot.signalIds.includes(signalId))
			{
				const updated = new Dream({
					...snapshot,
					signalIds: snapshot.signalIds.filter(function KeepSignal(candidate): boolean
					{
						return candidate !== signalId;
					}),
					updatedAt: new Date().toISOString()
				});
				const persistence = this.CreatePersistenceRecord(updated);
				const previousPath = this.records.get(dreamId)?.filePath ?? null;
				await this.repository.SaveAsync(persistence, previousPath);
				this.dreams.set(dreamId, updated);
				this.records.set(dreamId, persistence);
			}
		}
	}

	// Loads persisted records once for this application run.
	private async EnsureLoadedAsync(): Promise<void>
	{
		if (!this.isLoaded)
		{
			const records = await this.repository.LoadAsync();

			for (const persistence of records)
			{
				const dream = new Dream(persistence.dream);
				const hasDream = this.dreams.has(dream.GetId());

				if (!hasDream)
				{
					this.dreams.set(dream.GetId(), dream);
					this.records.set(dream.GetId(), persistence);
				}

			}

			this.isLoaded = true;
		}
	}

	// Preserves immutable ownership values and assigns the aggregate save timestamp.
	private CreateSaveSnapshot(snapshot: DreamSnapshot, existing: Dream | undefined): DreamSnapshot
	{
		const existingSnapshot = existing?.ToSnapshot();
		const timestamp = new Date().toISOString();
		const saved: DreamSnapshot = {
			...structuredClone(snapshot),
			workId: existingSnapshot?.workId ?? snapshot.workId,
			createdAt: existingSnapshot?.createdAt ?? snapshot.createdAt,
			updatedAt: timestamp
		};

		return saved;
	}

	// Creates the persistence record owned by this library.
	private CreatePersistenceRecord(dream: Dream): DreamPersistenceRecord
	{
		const snapshot = dream.ToSnapshot();
		const filePath = this.CreatePrimaryPath(snapshot);
		const persistence: DreamPersistenceRecord = {
			dream: snapshot,
			filePath
		};

		this.AssertPrimaryPath(filePath);

		return persistence;
	}

	// Creates a stable readable filename from an already-valid Dream record.
	private CreatePrimaryPath(dream: DreamSnapshot): string
	{
		const slug = dream.title.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "dream";
		const fileName = `${slug}--${dream.id}.md`;
		const filePath = path.resolve(this.primaryPath, dream.workId, fileName);

		return filePath;
	}

	// Proves that a primary Dream path remains inside the primary library root.
	private AssertPrimaryPath(filePath: string): void
	{
		const rootPath = path.resolve(this.primaryPath);
		const relativePath = path.relative(rootPath, filePath);
		const isOutsideRoot = relativePath === "" || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);

		if (isOutsideRoot)
		{
			throw new Error("Dream persistence path is outside the primary library");
		}
	}

	// Rejects unsafe identifiers before they influence Dream persistence paths.
	private ValidateIdentifier(value: string, label: string): void
	{
		const pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
		const isValid = pattern.test(value);

		if (!isValid)
		{
			throw new Error(`${label} is invalid`);
		}
	}
}
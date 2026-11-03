import { ChatRepository } from "../chat/ChatRepository.js";
import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
	CreateDreamCommand,
	CreateDreamFolderCommand,
	DeleteDreamFolderCommand,
	DreamCatalogueSnapshot,
	DreamFolderSnapshot,
	DreamLocationSnapshot,
	DreamSnapshot,
	MoveDreamCommand,
	UpdateDreamCommand
} from "../../shared/dreams/DreamTypes.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";
import type { LibraryService } from "../library/LibraryService.js";
import { Errors } from "../diagnostics/MainErrorManager.js";
import type { SignalRepository } from "../signals/SignalRepository.js";
import { DreamTrashRepository } from "./DreamTrashRepository.js";
import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import { Dream } from "./Dream.js";
import { DreamRepository, type DreamPersistenceRecord } from "./DreamRepository.js";
import { WorkStoragePaths } from "./WorkStoragePaths.js";

// One authoritative in-memory Dream together with its repository metadata.
interface DreamEntry
{
	// Authoritative in-memory Dream aggregate.
	dream: Dream;
	// Repository-owned origin and path metadata for that aggregate.
	persistence: DreamPersistenceRecord;
}

// Owns every Dream aggregate and the Signals contained by each Dream.
export class DreamLibrary
{
	// Authoritative Dream aggregates and persistence metadata keyed by stable identity.
	private readonly entries = new Map<string, DreamEntry>();
	// Filesystem-backed reader folders keyed by work and relative path.
	private readonly folders = new Map<string, DreamFolderSnapshot>();
	// Completion gates for mutations queued against each Dream identity.
	private readonly mutations = new Map<string | symbol, Promise<void>>();
	// Private queue identity cannot collide with any persisted Dream identifier.
	private readonly trashMutationKey = Symbol("DreamTrash");
	// Owns retained aggregates and interrupted-operation recovery.
	private readonly trash: DreamTrashRepository;
	// Completion gates for live operations admitted before a reconciliation begins.
	private readonly catalogueOperations = new Map<symbol, Promise<void>>();
	// Blocks new operations while reconciliation waits for existing operations and scans disk.
	private catalogueBarrier: Promise<void> | null = null;
	// Coalesces concurrent explicit reload requests into one filesystem scan.
	private reloadPromise: Promise<DreamCatalogueSnapshot> | null = null;
	// Shares one persistence load across every concurrent catalogue request.
	private loadPromise: Promise<void> | null = null;

	// Creates the authoritative Dream library and its child Signal repository.
	public constructor(
		private readonly primaryPath: string,
		private readonly repository: DreamRepository,
		private readonly signalRepository: SignalRepository,
		private readonly documents: LibraryService,
		private readonly workPaths: WorkStoragePaths,
		conversations: ChatRepository,
		trashPath: string)
	{
		this.trash = new DreamTrashRepository(primaryPath, repository, signalRepository, conversations, workPaths, trashPath);
	}

	// Holds the existing aggregate lease while a canonical context consumer runs.
	public async WithSnapshotAsync<T>(id: string, operation: (snapshot: DreamSnapshot) => Promise<T>): Promise<T>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let result: T;
		try
		{
			await this.EnsureLoadedAsync();
			this.ValidateIdentifier(id, "Dream identifier");
			const release = await this.AcquireMutationAsync(id);
			try
			{
				const entry = this.entries.get(id);
				if (entry === undefined) throw ApplicationError.Expected("not-found", "DREAM_NOT_FOUND", "This Dream is no longer available.");
				const snapshot = entry.dream.ToSnapshot();
				result = await operation(snapshot);
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}
		return result;
	}

	// Lists the current canonical catalogue.
	public async ListAsync(): Promise<DreamCatalogueSnapshot>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let catalogue: DreamCatalogueSnapshot;

		try
		{
			await this.EnsureLoadedAsync();
			catalogue = this.CreateCatalogueSnapshot();
		}
		finally
		{
			releaseCatalogue();
		}

		return catalogue;
	}

	// Explicitly reconciles disk state while preserving the previous catalogue on any failure.
	public async ReloadAsync(): Promise<DreamCatalogueSnapshot>
	{
		if (this.reloadPromise === null)
		{
			this.reloadPromise = this.PerformReloadAsync();
		}
		const reload = this.reloadPromise;
		let catalogue: DreamCatalogueSnapshot;
		try
		{
			catalogue = await reload;
		}
		finally
		{
			if (this.reloadPromise === reload) this.reloadPromise = null;
		}

		return catalogue;
	}

	// Reserves exclusive catalogue admission before awaiting in-flight Dream, Signal, or trash work.
	private async PerformReloadAsync(): Promise<DreamCatalogueSnapshot>
	{
		let release!: () => void;
		this.catalogueBarrier = new Promise<void>(function CaptureRelease(resolve): void
		{
			release = resolve;
		});
		const pending = [...this.catalogueOperations.values()];
		let catalogue: DreamCatalogueSnapshot;
		try
		{
			await Promise.all(pending);
			await this.LoadAsync();
			this.loadPromise = Promise.resolve();
			catalogue = this.CreateCatalogueSnapshot();
		}
		catch (error)
		{
			throw error;
		}
		finally
		{
			this.catalogueBarrier = null;
			release();
		}

		return catalogue;
	}

	// Admits ordinary operations concurrently, waiting only when an explicit reload owns the catalogue.
	private async AcquireCatalogueOperationAsync(): Promise<() => void>
	{
		while (this.catalogueBarrier !== null)
		{
			await this.catalogueBarrier;
		}
		const key = Symbol("CatalogueOperation");
		let complete!: () => void;
		const gate = new Promise<void>(function CaptureCompletion(resolve): void
		{
			complete = resolve;
		});
		this.catalogueOperations.set(key, gate);
		const operations = this.catalogueOperations;

		// Releases shared admission even when the admitted operation fails.
		function Release(): void
		{
			operations.delete(key);
			complete();
		}

		return Release;
	}

	// Projects the currently committed catalogue without performing filesystem I/O.
	private CreateCatalogueSnapshot(): DreamCatalogueSnapshot
	{
		const dreams: DreamSnapshot[] = [];
		const locations: DreamLocationSnapshot[] = [];

		for (const entry of this.entries.values())
		{
			const dream = entry.dream.ToSnapshot();
			dreams.push(dream);
			locations.push({
				dreamId: dream.id,
				workId: dream.workId,
				folderPath: this.GetFolderPath(entry.persistence)
			});
		}
		const folders = [...this.folders.values()];
		folders.sort(function CompareFolders(first, second): number
		{
			return first.path.localeCompare(second.path);
		});
		const catalogue: DreamCatalogueSnapshot = { dreams, folders, locations };

		return catalogue;
	}

	// Creates and persists one new Dream through the only Dream creation API.
	public async CreateAsync(command: CreateDreamCommand): Promise<DreamSnapshot>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let created: DreamSnapshot;

		try
		{
			await this.EnsureLoadedAsync();
			this.ValidateFolderPath(command.folderPath, true);
			const folderKey = this.CreateFolderKey(command.workId, command.folderPath);

			if (command.folderPath.length > 0 && !this.folders.has(folderKey))
			{
				throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream folder does not exist: ${command.folderPath}`);
			}

			const timestamp = new Date().toISOString();
			const dream = Dream.Create(command, randomUUID(), timestamp);
			const persistence = this.CreatePersistenceRecord(dream, command.folderPath);
			await this.repository.SaveAsync(persistence);
			this.entries.set(dream.GetId(), { dream, persistence });
			created = dream.ToSnapshot();
		}
		finally
		{
			releaseCatalogue();
		}

		return created;
	}

	// Updates reader-editable Dream fields while preserving identity, ownership, and child Signals.
	public async UpdateAsync(command: UpdateDreamCommand): Promise<DreamSnapshot>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let saved: DreamSnapshot;

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(command.dreamId);

			try
			{
				const existing = this.entries.get(command.dreamId);

				if (existing === undefined)
				{
					throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream does not exist: ${command.dreamId}`);
				}

				const updated = existing.dream.Update(command, new Date().toISOString());
				const folderPath = this.GetFolderPath(existing.persistence);
				const persistence = this.CreatePersistenceRecord(updated, folderPath);
				await this.repository.SaveAsync(persistence, existing.persistence.filePath);
				this.entries.set(updated.GetId(), { dream: updated, persistence });
				saved = updated.ToSnapshot();
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}

		return saved;
	}

	// Deletes one Dream and every Signal it owns.
	public async DeleteAsync(dreamId: string): Promise<void>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(dreamId);

			try
			{
				this.ValidateIdentifier(dreamId, "Dream identifier");
				const entry = this.entries.get(dreamId);

				if (entry !== undefined)
				{
					const releaseTrash = await this.AcquireMutationAsync(this.trashMutationKey);
					try
					{
						const snapshot = entry.dream.ToSnapshot();
						const trashId = await this.trash.StageAsync(entry.persistence, snapshot);
						this.entries.delete(dreamId);
						try
						{
							await this.trash.FinishDeletionAsync(trashId);
						}
						catch (error)
						{
							Errors.ReportWarning("DreamLibrary", error, "The Dream and its Signals are safely retained in Trash. Cleanup is pending and will be retried before restore, permanent removal, or at startup.");
						}
					}
					finally
					{
						releaseTrash();
					}
				}
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}
	}

	// Lists retained Dreams, including interrupted operations available for retry.
	public async ListTrashAsync(): Promise<readonly DreamTrashSnapshot[]>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let records: readonly DreamTrashSnapshot[];

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(this.trashMutationKey);
			try
			{
				records = await this.trash.ListAsync();
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}

		return records;
	}

	// Restores a retained aggregate without replacing an existing live Dream.
	public async RestoreTrashAsync(id: string): Promise<void>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(this.trashMutationKey);
			try
			{
				const records = await this.trash.ListAsync();
				const record = records.find(function Match(candidate): boolean { return candidate.id === id; });
				if (record === undefined) throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", "Trash entry does not exist.");
				if (this.entries.has(record.dreamId)) throw ApplicationError.Expected("conflict", "INVALID_DREAM_COMMAND", "A Dream with this identity already exists. Restore was cancelled.");
				const persistence = await this.trash.RestoreAsync(id);
				const dream = new Dream(persistence.dream);
				this.entries.set(dream.GetId(), { dream, persistence });
				const folderPaths = await this.repository.LoadFolderPathsAsync();
				for (const location of folderPaths)
				{
					const folder = this.CreateFolderSnapshot(location.workId, location.folderPath);
					const key = this.CreateFolderKey(location.workId, location.folderPath);
					this.folders.set(key, folder);
				}
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}
	}

	// Permanently removes one retained Dream after explicit reader confirmation.
	public async PurgeTrashAsync(id: string): Promise<void>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(this.trashMutationKey);
			try
			{
				await this.trash.PurgeAsync(id);
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}
	}

	// Empties the confirmed trash while preserving any interrupted restore.
	public async EmptyTrashAsync(): Promise<void>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(this.trashMutationKey);
			try
			{
				const records = await this.trash.ListAsync();
				for (const record of records)
				{
					if (record.restoring) throw ApplicationError.Expected("validation", "INVALID_DREAM_COMMAND", "Finish restoring the interrupted Dream before emptying Trash.");
				}
				for (const record of records) await this.trash.PurgeAsync(record.id);
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}
	}

	// Creates one filesystem-backed folder beneath a work's Dream root.
	public async CreateFolderAsync(command: CreateDreamFolderCommand): Promise<DreamFolderSnapshot>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let folder: DreamFolderSnapshot;

		try
		{
			await this.EnsureLoadedAsync();
			this.ValidateIdentifier(command.workId, "Work identifier");
			this.ValidateFolderPath(command.parentPath, true);
			this.ValidateFolderName(command.name);
			const parentKey = this.CreateFolderKey(command.workId, command.parentPath);

			if (command.parentPath.length > 0 && !this.folders.has(parentKey))
			{
				throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Parent Dream folder does not exist: ${command.parentPath}`);
			}

			const folderPath = command.parentPath.length === 0
				? command.name
				: `${command.parentPath}/${command.name}`;
			const key = this.CreateFolderKey(command.workId, folderPath);

			if (this.folders.has(key))
			{
				throw ApplicationError.Expected("conflict", "INVALID_DREAM_COMMAND", `Dream folder already exists: ${folderPath}`);
			}

			const absolutePath = this.ResolveFolderPath(command.workId, folderPath);
			await this.repository.CreateFolderAsync(absolutePath);
			folder = this.CreateFolderSnapshot(command.workId, folderPath);
			this.folders.set(key, folder);
		}
		finally
		{
			releaseCatalogue();
		}

		return folder;
	}

	// Deletes one empty Dream folder without deleting or relocating its contents.
	public async DeleteFolderAsync(command: DeleteDreamFolderCommand): Promise<void>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();

		try
		{
			await this.EnsureLoadedAsync();
			this.ValidateIdentifier(command.workId, "Work identifier");
			this.ValidateFolderPath(command.folderPath, false);
			const key = this.CreateFolderKey(command.workId, command.folderPath);

			if (!this.folders.has(key))
			{
				throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream folder does not exist: ${command.folderPath}`);
			}

			const childPrefix = `${command.folderPath}/`;
			const hasChildFolder = [...this.folders.values()].some(function HasChild(folder): boolean
			{
				return folder.workId === command.workId && folder.path.startsWith(childPrefix);
			});
			let hasDream = false;
			for (const entry of this.entries.values())
			{
				const dream = entry.dream.ToSnapshot();
				const folderPath = this.GetFolderPath(entry.persistence);
				if (dream.workId === command.workId
					&& (folderPath === command.folderPath || folderPath.startsWith(childPrefix)))
				{
					hasDream = true;
				}
			}

			if (hasChildFolder || hasDream)
			{
				throw ApplicationError.Expected("conflict", "INVALID_DREAM_COMMAND", "Dream folder must be empty before it can be deleted.");
			}

			const absolutePath = this.ResolveFolderPath(command.workId, command.folderPath);
			await this.repository.DeleteFolderAsync(absolutePath);
			this.folders.delete(key);
		}
		finally
		{
			releaseCatalogue();
		}
	}

	// Moves one Dream file to a folder within its immutable owning work.
	public async MoveDreamAsync(command: MoveDreamCommand): Promise<DreamLocationSnapshot>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let location: DreamLocationSnapshot;

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(command.dreamId);

			try
			{
				this.ValidateIdentifier(command.dreamId, "Dream identifier");
				this.ValidateFolderPath(command.folderPath, true);
				const entry = this.entries.get(command.dreamId);

				if (entry === undefined)
				{
					throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream does not exist: ${command.dreamId}`);
				}

				const dream = entry.dream.ToSnapshot();
				const folderKey = this.CreateFolderKey(dream.workId, command.folderPath);

				if (command.folderPath.length > 0 && !this.folders.has(folderKey))
				{
					throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream folder does not exist: ${command.folderPath}`);
				}

				const currentFolderPath = this.GetFolderPath(entry.persistence);

				if (currentFolderPath !== command.folderPath)
				{
					const persistence = this.CreatePersistenceRecord(entry.dream, command.folderPath);
					await this.repository.SaveAsync(persistence, entry.persistence.filePath);
					entry.persistence = persistence;
				}

				location = {
					dreamId: dream.id,
					workId: dream.workId,
					folderPath: command.folderPath
				};
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}

		return location;
	}

	// Creates one Signal inside its immutable owning Dream.
	public async CreateSignalAsync(command: CreateSignalCommand): Promise<SignalRecord>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let savedSignal: SignalRecord;

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(command.dreamId);

			try
			{
				const dream = this.RequireDream(command.dreamId);
				const document = await this.documents.GetAsync(dream.ToSnapshot().workId);
				const timestamp = new Date().toISOString();
				const change = dream.CreateSignal(command, randomUUID(), timestamp, document);
				await this.signalRepository.SaveAsync(change.signal);
				this.ReplaceDream(change.dream);
				savedSignal = change.signal;
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}

		return savedSignal;
	}

	// Updates one Signal without permitting its Dream ownership to change.
	public async UpdateSignalAsync(command: UpdateSignalCommand): Promise<SignalRecord>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();
		let savedSignal: SignalRecord;

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(command.dreamId);

			try
			{
				const dream = this.RequireDream(command.dreamId);
				const document = await this.documents.GetAsync(dream.ToSnapshot().workId);
				const change = dream.UpdateSignal(command, new Date().toISOString(), document);
				await this.signalRepository.SaveAsync(change.signal);
				this.ReplaceDream(change.dream);
				savedSignal = change.signal;
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}

		return savedSignal;
	}

	// Deletes one Signal from its immutable owning Dream.
	public async DeleteSignalAsync(command: DeleteSignalCommand): Promise<void>
	{
		const releaseCatalogue = await this.AcquireCatalogueOperationAsync();

		try
		{
			await this.EnsureLoadedAsync();
			const release = await this.AcquireMutationAsync(command.dreamId);

			try
			{
				const dream = this.RequireDream(command.dreamId);
				const change = dream.DeleteSignal(command);
				await this.signalRepository.DeleteAsync(change.signal);
				this.ReplaceDream(change.dream);
			}
			finally
			{
				release();
			}
		}
		finally
		{
			releaseCatalogue();
		}
	}

	// Reserves a place before waiting, and releases it independently of operation success.
	private async AcquireMutationAsync(dreamId: string | symbol): Promise<() => void>
	{
		if (typeof dreamId === "string") this.ValidateIdentifier(dreamId, "Dream identifier");
		const previous = this.mutations.get(dreamId);
		let complete!: () => void;
		const gate = new Promise<void>(function CaptureCompletion(resolve): void
		{
			complete = resolve;
		});
		this.mutations.set(dreamId, gate);
		const mutations = this.mutations;

		// Removes only the final gate; later queued operations retain their place.
		function Release(): void
		{
			if (mutations.get(dreamId) === gate)
			{
				mutations.delete(dreamId);
			}
			complete();
		}

		if (previous !== undefined)
		{
			await previous;
		}

		return Release;
	}

	// Shares the initial load, clearing only the failed promise so a later request can retry.
	private async EnsureLoadedAsync(): Promise<void>
	{
		if (this.loadPromise === null)
		{
			this.loadPromise = this.LoadAsync();
		}

		const loading = this.loadPromise;
		try
		{
			await loading;
		}
		catch (error)
		{
			if (this.loadPromise === loading) this.loadPromise = null;
			throw error;
		}
	}

	// Stages a complete aggregate catalogue and publishes it only after every read and validation succeeds.
	private async LoadAsync(): Promise<void>
	{
		await this.trash.RecoverAsync();
		const entries = new Map<string, DreamEntry>();
		const folders = new Map<string, DreamFolderSnapshot>();
		const dreamRecords = await this.repository.LoadAsync();
		const folderPaths = await this.repository.LoadFolderPathsAsync();

		for (const folderPath of folderPaths)
		{
			this.ValidateIdentifier(folderPath.workId, "Folder work identifier");
			this.ValidateFolderPath(folderPath.folderPath, false);
			const folder = this.CreateFolderSnapshot(folderPath.workId, folderPath.folderPath);
			const key = this.CreateFolderKey(folder.workId, folder.path);
			folders.set(key, folder);
		}

		for (const persistence of dreamRecords)
		{
			this.GetFolderPath(persistence);
			const dream = new Dream(persistence.dream);
			entries.set(dream.GetId(), { dream, persistence });
		}

		const persistedSignals = await this.signalRepository.LoadAsync();

		for (const persisted of persistedSignals)
		{
			const owner = entries.get(persisted.dreamId);

			if (owner === undefined)
			{
				Errors.Warning(
					"DreamLibrary",
					"Signal refers to a missing owning Dream and was left untouched for recovery.",
					{ signalId: persisted.id, dreamId: persisted.dreamId });
			}

			if (owner !== undefined)
			{
				const change = owner.dream.LoadSignal(persisted);
				owner.dream = change.dream;
			}
		}

		this.entries.clear();
		for (const [id, entry] of entries) this.entries.set(id, entry);
		this.folders.clear();
		for (const [key, folder] of folders) this.folders.set(key, folder);
	}

	// Replaces one aggregate while preserving its repository metadata.
	private ReplaceDream(dream: Dream): void
	{
		const entry = this.entries.get(dream.GetId());

		if (entry === undefined)
		{
			throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream does not exist: ${dream.GetId()}`);
		}

		entry.dream = dream;
	}

	// Returns one known Dream or rejects an invalid ownership request.
	private RequireDream(dreamId: string): Dream
	{
		this.ValidateIdentifier(dreamId, "Dream identifier");
		const dream = this.entries.get(dreamId)?.dream;

		if (dream === undefined)
		{
			throw ApplicationError.Expected("not-found", "INVALID_DREAM_COMMAND", `Dream does not exist: ${dreamId}`);
		}

		return dream;
	}

	// Creates the persistence record owned by this library.
	private CreatePersistenceRecord(dream: Dream, folderPath: string): DreamPersistenceRecord
	{
		const snapshot = dream.ToSnapshot();
		const filePath = this.CreatePrimaryPath(snapshot, folderPath);
		const persistence: DreamPersistenceRecord = {
			dream: snapshot,
			filePath
		};
		this.AssertPrimaryPath(filePath);

		return persistence;
	}

	// Creates a stable readable filename from an already-valid Dream record.
	private CreatePrimaryPath(dream: DreamSnapshot, folderPath: string): string
	{
		const slug = dream.title.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "dream";
		const fileName = `${slug}--${dream.id}.md`;
		const folderSegments = folderPath.length === 0 ? [] : folderPath.split("/");
		const workRoot = this.workPaths.Resolve(dream.workId, "Dreams");
		const filePath = path.resolve(workRoot, ...folderSegments, fileName);

		return filePath;
	}

	// Derives one renderer-safe relative folder path from repository metadata.
	private GetFolderPath(record: DreamPersistenceRecord): string
	{
		const workRoot = this.workPaths.Resolve(record.dream.workId, "Dreams");
		const directoryPath = path.dirname(record.filePath);
		this.AssertWorkPath(record.dream.workId, directoryPath, true);
		const relativePath = path.relative(workRoot, directoryPath);
		const folderPath = relativePath === "" ? "" : relativePath.split(path.sep).join("/");

		return folderPath;
	}

	// Creates one immutable folder projection from a canonical relative path.
	private CreateFolderSnapshot(workId: string, folderPath: string): DreamFolderSnapshot
	{
		const segments = folderPath.split("/");
		const name = segments[segments.length - 1] ?? folderPath;
		const parentPath = segments.slice(0, -1).join("/");
		const folder: DreamFolderSnapshot = { workId, path: folderPath, name, parentPath };

		return folder;
	}

	// Creates the internal identity for one work-scoped folder.
	private CreateFolderKey(workId: string, folderPath: string): string
	{
		const key = `${workId}\u0000${folderPath}`;

		return key;
	}

	// Resolves and proves one work-relative folder path before repository access.
	private ResolveFolderPath(workId: string, folderPath: string): string
	{
		const segments = folderPath.split("/");
		const workRoot = this.workPaths.Resolve(workId, "Dreams");
		const folder = path.resolve(workRoot, ...segments);
		this.AssertWorkPath(workId, folder, false);

		return folder;
	}

	// Proves that a path remains within one work's Dream root.
	private AssertWorkPath(workId: string, targetPath: string, allowRoot: boolean): void
	{
		const workRoot = this.workPaths.Resolve(workId, "Dreams");
		const relativePath = path.relative(workRoot, targetPath);
		const isRoot = relativePath === "";
		const isOutside = relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);

		if (isOutside || (!allowRoot && isRoot))
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM_COMMAND", "Dream folder path is outside the work library.");
		}
	}

	// Rejects noncanonical or unsafe relative folder paths.
	private ValidateFolderPath(folderPath: string, allowRoot: boolean): void
	{
		const segments = folderPath.length === 0 ? [] : folderPath.split("/");
		const isCanonical = segments.join("/") === folderPath;

		if ((!allowRoot && segments.length === 0) || !isCanonical)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM_COMMAND", "Dream folder path is invalid.");
		}

		for (const segment of segments)
		{
			this.ValidateFolderName(segment);
		}
	}

	// Rejects folder names that are ambiguous, unsafe, or invalid on supported filesystems.
	private ValidateFolderName(name: string): void
	{
		const invalidCharacters = /[<>:"/\\|?*\u0000-\u001f]/u;
		const isInvalid = name.length === 0
			|| name.length > 80
			|| name !== name.trim()
			|| name === "."
			|| name === ".."
			|| name.endsWith(".")
			|| invalidCharacters.test(name);

		if (isInvalid)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM_COMMAND", "Dream folder name is invalid.");
		}
	}

	// Proves that a primary Dream path remains inside the primary library root.
	private AssertPrimaryPath(filePath: string): void
	{
		const rootPath = path.resolve(this.primaryPath);
		const relativePath = path.relative(rootPath, filePath);
		const isOutsideRoot = relativePath === "" || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);

		if (isOutsideRoot)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM_COMMAND", "Dream persistence path is outside the primary library");
		}
	}

	// Rejects unsafe identifiers before they influence persistence or ownership.
	private ValidateIdentifier(value: string, label: string): void
	{
		const pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
		const isValid = pattern.test(value);

		if (!isValid)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM_COMMAND", `${label} is invalid`);
		}
	}
}

import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import type { CreateDreamCommand, CreateDreamFolderCommand, DeleteDreamFolderCommand, DreamCatalogueSnapshot, DreamFolderSnapshot, DreamLocationSnapshot, DreamSnapshot, MoveDreamCommand, UpdateDreamCommand } from "../../shared/dreams/DreamTypes.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";
import { DreamLibrary } from "./DreamLibrary.js";

// Coordinates Dream use cases through the reader-owned DreamLibrary aggregate.
export class DreamService
{
	// Creates the use-case boundary around the owned Dream aggregate root.
	public constructor(private readonly library: DreamLibrary)
	{
	}

	// Delegates ListDreamTrash to the canonical aggregate owner.
	public ListTrashAsync(): Promise<readonly DreamTrashSnapshot[]>
	{
		const result = this.library.ListTrashAsync();
		return result;
	}

	// Delegates RestoreDreamTrash to the canonical aggregate owner.
	public RestoreTrashAsync(id: string): Promise<void>
	{
		const result = this.library.RestoreTrashAsync(id);
		return result;
	}

	// Delegates PurgeDreamTrash to the canonical aggregate owner.
	public PurgeTrashAsync(id: string): Promise<void>
	{
		const result = this.library.PurgeTrashAsync(id);
		return result;
	}

	// Delegates EmptyDreamTrash to the canonical aggregate owner.
	public EmptyTrashAsync(): Promise<void>
	{
		const result = this.library.EmptyTrashAsync();
		return result;
	}

	// Reconciles canonical files through the aggregate owner.
	public ReloadAsync(): Promise<DreamCatalogueSnapshot>
	{
		const catalogue = this.library.ReloadAsync();

		return catalogue;
	}

	// Lists immutable Dream records for renderer IPC.
	public ListAsync(): Promise<DreamCatalogueSnapshot>
	{
		const dreams = this.library.ListAsync();

		return dreams;
	}

	// Creates one reader-owned folder in the Dream library.
	public CreateFolderAsync(command: CreateDreamFolderCommand): Promise<DreamFolderSnapshot>
	{
		const folder = this.library.CreateFolderAsync(command);

		return folder;
	}

	// Deletes one empty reader-owned Dream folder.
	public DeleteFolderAsync(command: DeleteDreamFolderCommand): Promise<void>
	{
		const deletion = this.library.DeleteFolderAsync(command);

		return deletion;
	}

	// Moves one Dream into a folder within its owning work.
	public MoveDreamAsync(command: MoveDreamCommand): Promise<DreamLocationSnapshot>
	{
		const location = this.library.MoveDreamAsync(command);

		return location;
	}

	// Creates one Dream through the aggregate-owned creation workflow.
	public CreateAsync(command: CreateDreamCommand): Promise<DreamSnapshot>
	{
		const created = this.library.CreateAsync(command);

		return created;
	}

	// Updates an IPC record through domain validation and normalization.
	public UpdateAsync(command: UpdateDreamCommand): Promise<DreamSnapshot>
	{
		const updated = this.library.UpdateAsync(command);

		return updated;
	}

	// Deletes a Dream through its aggregate-owned origin rules.
	public DeleteAsync(dreamId: string): Promise<void>
	{
		const deletion = this.library.DeleteAsync(dreamId);

		return deletion;
	}

	// Creates one Signal inside exactly one Dream.
	public CreateSignalAsync(command: CreateSignalCommand): Promise<SignalRecord>
	{
		const created = this.library.CreateSignalAsync(command);

		return created;
	}

	// Updates one Signal without changing its Dream ownership.
	public UpdateSignalAsync(command: UpdateSignalCommand): Promise<SignalRecord>
	{
		const updated = this.library.UpdateSignalAsync(command);

		return updated;
	}

	// Deletes one Signal from its owning Dream.
	public DeleteSignalAsync(command: DeleteSignalCommand): Promise<void>
	{
		const deletion = this.library.DeleteSignalAsync(command);

		return deletion;
	}
}

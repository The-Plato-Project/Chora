import { randomUUID } from "node:crypto";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { DreamLibrary } from "./DreamLibrary.js";

// Coordinates Dream use cases through the reader-owned DreamLibrary aggregate.
export class DreamService
{
	// Creates the use-case boundary around the owned Dream aggregate root.
	public constructor(private readonly library: DreamLibrary)
	{
	}

	// Lists immutable Dream records for renderer IPC.
	public ListAsync(): Promise<DreamSnapshot[]>
	{
		const dreams = this.library.ListAsync();

		return dreams;
	}

	// Saves an IPC record through domain validation and normalization.
	public SaveAsync(dream: DreamSnapshot): Promise<DreamSnapshot>
	{
		const saved = this.library.SaveAsync(dream);

		return saved;
	}

	// Deletes a Dream through its aggregate-owned origin rules.
	public DeleteAsync(dreamId: string): Promise<void>
	{
		const deletion = this.library.DeleteAsync(dreamId);

		return deletion;
	}

	// Removes one Signal association from every Dream.
	public RemoveSignalEverywhereAsync(signalId: string): Promise<void>
	{
		const removal = this.library.RemoveSignalEverywhereAsync(signalId);

		return removal;
	}

	// Allocates a new canonical identifier owned by the main process, for a Dream or Dream signal.
	public AllocateIdAsync(): Promise<string>
	{
		const id = randomUUID();

		return Promise.resolve(id);
	}
}

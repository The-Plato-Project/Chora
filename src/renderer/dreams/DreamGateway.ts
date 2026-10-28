import { ReadOperationAsync } from "../../shared/diagnostics/OperationResult.js";
import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import type { CreateDreamCommand, CreateDreamFolderCommand, DeleteDreamFolderCommand, DreamCatalogueSnapshot, DreamFolderSnapshot, DreamLocationSnapshot, DreamSnapshot, DreamSynopticViewRequest, MoveDreamCommand, UpdateDreamCommand } from "../../shared/dreams/DreamTypes.js";
import type { SelectionAction } from "../../shared/text/TextSelection.js";

// Stateless IPC client for the DreamView use cases exposed by the main process.
export class DreamGateway
{
	// Sends the narrow ListDreamTrash command.
	public ListTrashAsync(): Promise<readonly DreamTrashSnapshot[]>
	{
		const result = ReadOperationAsync(window.chora.ListDreamTrash());
		return result;
	}

	// Sends the narrow RestoreDreamTrash command.
	public RestoreTrashAsync(id: string): Promise<void>
	{
		const result = ReadOperationAsync(window.chora.RestoreDreamTrash(id));
		return result;
	}

	// Sends the narrow PurgeDreamTrash command.
	public PurgeTrashAsync(id: string): Promise<void>
	{
		const result = ReadOperationAsync(window.chora.PurgeDreamTrash(id));
		return result;
	}

	// Sends the narrow EmptyDreamTrash command.
	public EmptyTrashAsync(): Promise<void>
	{
		const result = ReadOperationAsync(window.chora.EmptyDreamTrash());
		return result;
	}

	// Explicitly requests a filesystem reconciliation from the main-process owner.
	public ReloadAsync(): Promise<DreamCatalogueSnapshot>
	{
		const catalogue = ReadOperationAsync(window.chora.ReloadDreamCatalogue());

		return catalogue;
	}

	// Lists all Dreams visible to the reader.
	public ListAsync(): Promise<DreamCatalogueSnapshot>
	{
		return ReadOperationAsync(window.chora.ListDreamCatalogue());
	}

	// Creates one folder through the main-process Dream library.
	public CreateFolderAsync(command: CreateDreamFolderCommand): Promise<DreamFolderSnapshot>
	{
		return ReadOperationAsync(window.chora.CreateDreamFolder(command));
	}

	// Deletes one empty folder through the main-process Dream library.
	public DeleteFolderAsync(command: DeleteDreamFolderCommand): Promise<void>
	{
		return ReadOperationAsync(window.chora.DeleteDreamFolder(command));
	}

	// Moves one Dream into a folder through the main-process Dream library.
	public MoveDreamAsync(command: MoveDreamCommand): Promise<DreamLocationSnapshot>
	{
		return ReadOperationAsync(window.chora.MoveDream(command));
	}

	// Creates one Dream through the sole main-process Dream creation workflow.
	public CreateAsync(command: CreateDreamCommand): Promise<DreamSnapshot>
	{
		return ReadOperationAsync(window.chora.CreateDream(command));
	}

	// Updates one DreamView record through the main-process DreamView service.
	public UpdateAsync(command: UpdateDreamCommand): Promise<DreamSnapshot>
	{
		return ReadOperationAsync(window.chora.UpdateDream(command));
	}

	// Deletes one DreamView record through the main-process DreamView service.
	public DeleteAsync(dreamId: string): Promise<void>
	{
		return ReadOperationAsync(window.chora.DeleteDream(dreamId));
	}

	// Shows the native context menu for a DreamView source-passage selection.
	public ShowSourceContextMenuAsync(canAddToSelectedSignal: boolean): Promise<SelectionAction>
	{
		return ReadOperationAsync(window.chora.ShowDreamSourceContextMenu(canAddToSelectedSignal));
	}

	public CreateSynopticViewAsync(request: DreamSynopticViewRequest): Promise<string>
	{
		return ReadOperationAsync(window.chora.CreateDreamSynopticView(request));
	}

	public CancelSynopticViewAsync(dreamId: string): Promise<void>
	{
		return ReadOperationAsync(window.chora.CancelDreamSynopticView(dreamId));
	}
}

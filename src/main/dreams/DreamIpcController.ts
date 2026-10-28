import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { CreateDreamCommand, CreateDreamFolderCommand, DeleteDreamFolderCommand, DreamCatalogueSnapshot, DreamFolderSnapshot, DreamLocationSnapshot, DreamSnapshot, DreamSynopticViewRequest, MoveDreamCommand, UpdateDreamCommand } from "../../shared/dreams/DreamTypes.js";
import { DreamService } from "./DreamService.js";
import { DreamSynopticViewService } from "./DreamSynopticViewService.js";

export class DreamIpcController
{
	// IPC channels registered by this controller.
	private readonly channels = [IPC_CHANNELS.reloadDreamCatalogue, IPC_CHANNELS.listDreamTrash, IPC_CHANNELS.restoreDreamTrash, IPC_CHANNELS.purgeDreamTrash, IPC_CHANNELS.emptyDreamTrash, IPC_CHANNELS.createDream, IPC_CHANNELS.updateDream, IPC_CHANNELS.deleteDream, IPC_CHANNELS.listDreamCatalogue, IPC_CHANNELS.createDreamFolder, IPC_CHANNELS.deleteDreamFolder, IPC_CHANNELS.moveDream, IPC_CHANNELS.createDreamSynopticView, IPC_CHANNELS.cancelDreamSynopticView] as const;
	// Bound Electron handler that creates one Dream record.
	private readonly createHandler: (_event: IpcMainInvokeEvent, command: CreateDreamCommand) => Promise<DreamSnapshot>;
	// Bound Electron handler that updates one Dream record.
	private readonly updateHandler: (_event: IpcMainInvokeEvent, command: UpdateDreamCommand) => Promise<DreamSnapshot>;
	// Bound Electron handler that deletes one Dream record.
	private readonly deleteHandler: (_event: IpcMainInvokeEvent, dreamId: string) => Promise<void>;
	// Bound Electron handler that lists all visible Dreams.
	private readonly listHandler: () => Promise<DreamCatalogueSnapshot>;
	// Bound Electron handler that creates one Dream folder.
	private readonly createFolderHandler: (_event: IpcMainInvokeEvent, command: CreateDreamFolderCommand) => Promise<DreamFolderSnapshot>;
	// Bound Electron handler that deletes one empty Dream folder.
	private readonly deleteFolderHandler: (_event: IpcMainInvokeEvent, command: DeleteDreamFolderCommand) => Promise<void>;
	// Bound Electron handler that moves one Dream between folders.
	private readonly moveDreamHandler: (_event: IpcMainInvokeEvent, command: MoveDreamCommand) => Promise<DreamLocationSnapshot>;
	private readonly createSynopticViewHandler: (_event: IpcMainInvokeEvent, request: DreamSynopticViewRequest) => Promise<string>;
	private readonly cancelSynopticViewHandler: (_event: IpcMainInvokeEvent, dreamId: string) => void;

	// Creates the IPC boundary for the Dream use-case service.
	public constructor(private readonly service: DreamService, private readonly synopticViews: DreamSynopticViewService)
	{
		this.createHandler = this.HandleCreateAsync.bind(this);
		this.updateHandler = this.HandleUpdateAsync.bind(this);
		this.deleteHandler = this.HandleDeleteAsync.bind(this);
		this.listHandler = this.HandleListAsync.bind(this);
		this.createFolderHandler = this.HandleCreateFolderAsync.bind(this);
		this.deleteFolderHandler = this.HandleDeleteFolderAsync.bind(this);
		this.moveDreamHandler = this.HandleMoveDreamAsync.bind(this);
		this.createSynopticViewHandler = this.HandleCreateSynopticViewAsync.bind(this);
		this.cancelSynopticViewHandler = this.HandleCancelSynopticView.bind(this);
	}

	// Registers Dream use cases with Electron's main-process IPC registry.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.reloadDreamCatalogue, this.HandleReloadAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.listDreamTrash, this.HandleListDreamTrashAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.restoreDreamTrash, this.HandleRestoreDreamTrashAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.purgeDreamTrash, this.HandlePurgeDreamTrashAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.emptyDreamTrash, this.HandleEmptyDreamTrashAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.createDream, this.createHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.updateDream, this.updateHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.deleteDream, this.deleteHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.listDreamCatalogue, this.listHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.createDreamFolder, this.createFolderHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.deleteDreamFolder, this.deleteFolderHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.moveDream, this.moveDreamHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.createDreamSynopticView, this.createSynopticViewHandler);
		IpcErrorBoundary.Register(IPC_CHANNELS.cancelDreamSynopticView, this.cancelSynopticViewHandler);
	}

	// Removes Dream use cases from Electron's main-process IPC registry.
	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	// Accepts no renderer-controlled paths or aggregate payloads for reconciliation.
	private HandleReloadAsync(): Promise<DreamCatalogueSnapshot>
	{
		const catalogue = this.service.ReloadAsync();

		return catalogue;
	}

	// Handles ListDreamTrash without accepting renderer paths or aggregate payloads.
	private HandleListDreamTrashAsync(): Promise<readonly DreamTrashSnapshot[]>
	{
		const result = this.service.ListTrashAsync();
		return result;
	}

	// Handles RestoreDreamTrash without accepting renderer paths or aggregate payloads.
	private HandleRestoreDreamTrashAsync(_event: IpcMainInvokeEvent, id: string): Promise<void>
	{
		const result = this.service.RestoreTrashAsync(id);
		return result;
	}

	// Handles PurgeDreamTrash without accepting renderer paths or aggregate payloads.
	private HandlePurgeDreamTrashAsync(_event: IpcMainInvokeEvent, id: string): Promise<void>
	{
		const result = this.service.PurgeTrashAsync(id);
		return result;
	}

	// Handles EmptyDreamTrash without accepting renderer paths or aggregate payloads.
	private HandleEmptyDreamTrashAsync(): Promise<void>
	{
		const result = this.service.EmptyTrashAsync();
		return result;
	}

	// Creates one renderer-submitted Dream through the application service.
	private HandleCreateAsync(_event: IpcMainInvokeEvent, command: CreateDreamCommand): Promise<DreamSnapshot>
	{
		const created = this.service.CreateAsync(command);

		return created;
	}

	// Updates one renderer-submitted Dream through the application service.
	private HandleUpdateAsync(_event: IpcMainInvokeEvent, command: UpdateDreamCommand): Promise<DreamSnapshot>
	{
		const updated = this.service.UpdateAsync(command);

		return updated;
	}

	// Deletes one renderer-requested Dream through the application service.
	private HandleDeleteAsync(_event: IpcMainInvokeEvent, dreamId: string): Promise<void>
	{
		const deletion = this.service.DeleteAsync(dreamId);

		return deletion;
	}

	// Lists all Dreams visible to the renderer.
	private HandleListAsync(): Promise<DreamCatalogueSnapshot>
	{
		const dreams = this.service.ListAsync();

		return dreams;
	}

	// Creates one validated folder through the Dream service.
	private HandleCreateFolderAsync(_event: IpcMainInvokeEvent, command: CreateDreamFolderCommand): Promise<DreamFolderSnapshot>
	{
		const folder = this.service.CreateFolderAsync(command);

		return folder;
	}

	// Deletes one empty folder through the Dream service.
	private HandleDeleteFolderAsync(_event: IpcMainInvokeEvent, command: DeleteDreamFolderCommand): Promise<void>
	{
		const deletion = this.service.DeleteFolderAsync(command);

		return deletion;
	}

	// Moves one Dream through the Dream service.
	private HandleMoveDreamAsync(_event: IpcMainInvokeEvent, command: MoveDreamCommand): Promise<DreamLocationSnapshot>
	{
		const location = this.service.MoveDreamAsync(command);

		return location;
	}

	private HandleCreateSynopticViewAsync(_event: IpcMainInvokeEvent, request: DreamSynopticViewRequest): Promise<string>
	{
		return this.synopticViews.CreateAsync(request);
	}

	private HandleCancelSynopticView(_event: IpcMainInvokeEvent, dreamId: string): void
	{
		this.synopticViews.Cancel(dreamId);
	}
}

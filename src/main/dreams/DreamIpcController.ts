import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type { DreamSnapshot, DreamSynopticViewRequest } from "../../shared/dreams/DreamTypes.js";
import { DreamService } from "./DreamService.js";
import { DreamSynopticViewService } from "./DreamSynopticViewService.js";

export class DreamIpcController
{
	// IPC channels registered by this controller.
	private readonly channels = [IPC_CHANNELS.saveDream, IPC_CHANNELS.deleteDream, IPC_CHANNELS.listDreams, IPC_CHANNELS.allocateDreamId, IPC_CHANNELS.createDreamSynopticView, IPC_CHANNELS.cancelDreamSynopticView] as const;
	// Bound Electron handler that persists one Dream record.
	private readonly saveHandler: (_event: IpcMainInvokeEvent, dream: DreamSnapshot) => Promise<DreamSnapshot>;
	// Bound Electron handler that deletes one Dream record.
	private readonly deleteHandler: (_event: IpcMainInvokeEvent, dreamId: string) => Promise<void>;
	// Bound Electron handler that lists all visible Dreams.
	private readonly listHandler: () => Promise<DreamSnapshot[]>;
	// Bound Electron handler that allocates a new canonical Dream or signal identifier.
	private readonly allocateIdHandler: () => Promise<string>;
	private readonly createSynopticViewHandler: (_event: IpcMainInvokeEvent, request: DreamSynopticViewRequest) => Promise<string>;
	private readonly cancelSynopticViewHandler: (_event: IpcMainInvokeEvent, dreamId: string) => void;

	// Creates the IPC boundary for the Dream use-case service.
	public constructor(private readonly service: DreamService, private readonly synopticViews: DreamSynopticViewService)
	{
		this.saveHandler = this.HandleSaveAsync.bind(this);
		this.deleteHandler = this.HandleDeleteAsync.bind(this);
		this.listHandler = this.HandleListAsync.bind(this);
		this.allocateIdHandler = this.HandleAllocateIdAsync.bind(this);
		this.createSynopticViewHandler = this.HandleCreateSynopticViewAsync.bind(this);
		this.cancelSynopticViewHandler = this.HandleCancelSynopticView.bind(this);
	}

	// Registers Dream use cases with Electron's main-process IPC registry.
	public Register(): void
	{
		ipcMain.handle(IPC_CHANNELS.saveDream, this.saveHandler);
		ipcMain.handle(IPC_CHANNELS.deleteDream, this.deleteHandler);
		ipcMain.handle(IPC_CHANNELS.listDreams, this.listHandler);
		ipcMain.handle(IPC_CHANNELS.allocateDreamId, this.allocateIdHandler);
		ipcMain.handle(IPC_CHANNELS.createDreamSynopticView, this.createSynopticViewHandler);
		ipcMain.handle(IPC_CHANNELS.cancelDreamSynopticView, this.cancelSynopticViewHandler);
	}

	// Removes Dream use cases from Electron's main-process IPC registry.
	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	// Saves one renderer-submitted Dream through the application service.
	private HandleSaveAsync(_event: IpcMainInvokeEvent, dream: DreamSnapshot): Promise<DreamSnapshot>
	{
		const saved = this.service.SaveAsync(dream);

		return saved;
	}

	// Deletes one renderer-requested Dream through the application service.
	private HandleDeleteAsync(_event: IpcMainInvokeEvent, dreamId: string): Promise<void>
	{
		const deletion = this.service.DeleteAsync(dreamId);

		return deletion;
	}

	// Lists all Dreams visible to the renderer.
	private HandleListAsync(): Promise<DreamSnapshot[]>
	{
		const dreams = this.service.ListAsync();

		return dreams;
	}

	// Allocates a new canonical identifier for a renderer-initiated Dream or Dream signal.
	private HandleAllocateIdAsync(): Promise<string>
	{
		const id = this.service.AllocateIdAsync();

		return id;
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

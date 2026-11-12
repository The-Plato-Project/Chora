import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import type {
	CreateVisionCommand,
	CreateVisionFolderCommand,
	DeleteVisionFolderCommand,
	MoveVisionCommand,
	UpdateVisionCommand,
	VisionCatalogueSnapshot,
	VisionFolderSnapshot,
	VisionSnapshot
} from "../../shared/visions/VisionTypes.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import type { VisionService } from "./VisionService.js";

export class VisionIpcController
{
	private readonly channels = [
		IPC_CHANNELS.createVision,
		IPC_CHANNELS.updateVision,
		IPC_CHANNELS.deleteVision,
		IPC_CHANNELS.listVisions,
		IPC_CHANNELS.createVisionFolder,
		IPC_CHANNELS.deleteVisionFolder,
		IPC_CHANNELS.moveVision
	] as const;

	public constructor(private readonly service: VisionService)
	{
	}

	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.createVision, this.HandleCreateAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.updateVision, this.HandleUpdateAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.deleteVision, this.HandleDeleteAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.listVisions, this.HandleListAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.createVisionFolder, this.HandleCreateFolderAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.deleteVisionFolder, this.HandleDeleteFolderAsync.bind(this));
		IpcErrorBoundary.Register(IPC_CHANNELS.moveVision, this.HandleMoveAsync.bind(this));
	}

	public Unregister(): void
	{
		for (const channel of this.channels) ipcMain.removeHandler(channel);
	}

	private HandleCreateAsync(_event: IpcMainInvokeEvent, command: CreateVisionCommand): Promise<VisionSnapshot>
	{
		return this.service.CreateAsync(command);
	}

	private HandleUpdateAsync(_event: IpcMainInvokeEvent, command: UpdateVisionCommand): Promise<VisionSnapshot>
	{
		return this.service.UpdateAsync(command);
	}

	private HandleDeleteAsync(_event: IpcMainInvokeEvent, visionId: string): Promise<void>
	{
		return this.service.DeleteAsync(visionId);
	}

	private HandleListAsync(): Promise<VisionCatalogueSnapshot>
	{
		return this.service.ListAsync();
	}

	private HandleCreateFolderAsync(_event: IpcMainInvokeEvent, command: CreateVisionFolderCommand): Promise<VisionFolderSnapshot>
	{
		return this.service.CreateFolderAsync(command);
	}

	private HandleDeleteFolderAsync(_event: IpcMainInvokeEvent, command: DeleteVisionFolderCommand): Promise<void>
	{
		return this.service.DeleteFolderAsync(command);
	}

	private HandleMoveAsync(_event: IpcMainInvokeEvent, command: MoveVisionCommand): Promise<VisionSnapshot>
	{
		return this.service.MoveAsync(command);
	}
}

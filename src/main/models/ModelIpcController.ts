import { ipcMain } from "electron";
import type { AvailableModel } from "../../shared/models/ModelSelection.js";
import { IPC_CHANNELS } from "../../shared/contracts/IpcChannels.js";
import { IpcErrorBoundary } from "../diagnostics/IpcErrorBoundary.js";
import { ModelApi } from "./ModelApi.js";

// Exposes model discovery without permitting renderer-supplied prompts or credentials.
export class ModelIpcController
{
	// Uses the same provider boundary that conversation execution will consume.
	public constructor(private readonly models: ModelApi = new ModelApi())
	{
	}

	// Registers model catalogue discovery with the existing diagnostic boundary.
	public Register(): void
	{
		IpcErrorBoundary.Register(IPC_CHANNELS.listModels, this.HandleListAsync.bind(this));
	}

	// Removes discovery when the application stops.
	public Unregister(): void
	{
		ipcMain.removeHandler(IPC_CHANNELS.listModels);
	}

	// Accepts no renderer configuration or provider paths.
	private async HandleListAsync(): Promise<readonly AvailableModel[]>
	{
		const models = await this.models.ListModelsAsync();
		return models;
	}
}

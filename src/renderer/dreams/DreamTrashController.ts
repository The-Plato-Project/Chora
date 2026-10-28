import type { DreamTrashSnapshot } from "../../shared/dreams/DreamTrashTypes.js";
import type { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import type { DreamCatalogueController } from "./DreamCatalogueController.js";
import type { DreamGateway } from "./DreamGateway.js";

// Owns trash reads and mutations separately from active Dream editing.
export class DreamTrashController
{
	// Shares the existing IPC gateway, diagnostics, and catalogue refresh owner.
	public constructor(private readonly gateway: DreamGateway, private readonly catalogue: DreamCatalogueController, private readonly errors: ErrorManager)
	{
	}

	// Reads the main-process trash projection.
	public async ListAsync(): Promise<readonly DreamTrashSnapshot[]>
	{
		let records: readonly DreamTrashSnapshot[];
		try
		{
			records = await this.gateway.ListTrashAsync();
		}
		catch (error)
		{
			this.errors.Capture("DreamTrash.List", error);
			throw error;
		}
		return records;
	}

	// Applies one explicit trash action and reports failures through application diagnostics.
	public async ExecuteAsync(action: "restore" | "purge" | "empty", id: string): Promise<boolean>
	{
		let completed = false;
		try
		{
			if (action === "restore") await this.gateway.RestoreTrashAsync(id);
			else if (action === "purge") await this.gateway.PurgeTrashAsync(id);
			else await this.gateway.EmptyTrashAsync();
			completed = true;
			await this.catalogue.RefreshAsync();
		}
		catch (error)
		{
			this.errors.Report("DreamTrashController", error, "Unable to complete the Trash operation. Reopen Trash to inspect the current state and retry.");
		}
		return completed;
	}
}

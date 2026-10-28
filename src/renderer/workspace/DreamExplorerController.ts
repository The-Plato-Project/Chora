import { CreateDreamView } from "../dreams/DreamView.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../library/LibraryStore.js";
import { DreamGateway } from "../dreams/DreamGateway.js";
import { DreamStore } from "../dreams/DreamStore.js";

import type { Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { SignalController } from "../signals/SignalController.js";
import type { DreamCatalogueController } from "../dreams/DreamCatalogueController.js";

// Owns Dream creation, folder selection, folder mutations, moves, and explicit Explorer reconciliation.
export class DreamExplorerController
{
	// Creation-event subscription owned by Explorer workflows.
	private readonly unsubscribe: Unsubscribe;
	// Owns organization commands using the shared store and canonical Dream gateway directly.
	public constructor(private readonly store: DreamStore, private readonly library: LibraryStore, private readonly gateway: DreamGateway, private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager, private readonly catalogue: DreamCatalogueController, private readonly signals: Pick<SignalController, "HasUncommittedChanges">)
	{
		this.unsubscribe = events.Subscribe("dream.create-requested", this.HandleCreateRequested.bind(this));
	}

	// Selects one exact folder in the active work.
	public SelectFolder(folderPath: string): void
	{
		const workId = this.library.GetText()?.id;

		if (workId !== undefined)
		{
			this.store.SetSelectedFolder(workId, folderPath);
		}
	}

	// Clears folder selection when the reader selects a Dream.
	public ClearFolderSelection(): void
	{
		const workId = this.library.GetText()?.id;

		if (workId !== undefined)
		{
			this.store.SetSelectedFolder(workId, null);
		}
	}

	// Reports whether one folder is the active Explorer selection.
	public IsFolderSelected(workId: string, folderPath: string): boolean
	{
		const selected = this.store.GetSelectedFolder(workId) === folderPath;

		return selected;
	}

	// Reconciles disk state after protecting unsaved Signal descriptions.
	public async ReloadAsync(): Promise<void>
	{
		if (this.signals.HasUncommittedChanges())
		{
			throw new Error("A Signal description has not finished saving. Finish or retry its save before reloading; your edit has been kept.");
		}
		await this.catalogue.ReloadFromDiskAsync();
	}

	// Creates a new DreamView from the reader's current passage selection, or reports why none is available.
	public async CreateFromCurrentSelectionAsync(): Promise<void>
	{
		const selection = this.library.GetContextSelection();

		if (selection !== null) await this.CreateDreamAsync(selection);
		else this.errors.Report("DreamExplorerController", new Error("No passage available."), "Open a text to begin a Dream.");
	}

	// Creates and opens one Dream through the sole canonical Dream creation API.
	public async CreateDreamAsync(selection: TextSelection): Promise<void>
	{
		const document = this.library.GetText();

		if (document !== null)
		{
			try
			{
				const source = document.CreateSelection(selection.start, selection.end);
				const folderPath = this.store.GetSelectedFolder(document.id) ?? "";
				const snapshot = await this.gateway.CreateAsync({
					workId: document.id,
					dialogue: document.title,
					source,
					folderPath
				});
				const dream = CreateDreamView(snapshot);
				this.store.UpsertCatalogueDream(dream);
				this.store.SetDreamLocation({ dreamId: dream.id, workId: dream.workId, folderPath });
				this.store.Open(dream, false);
				await this.events.PublishAsync("dream.catalogue-changed", { count: this.store.GetCatalogue().length });
				await this.events.PublishAsync("dream.opened", {});
			}
			catch (error)
			{
				this.errors.Report("DreamExplorerController", error, "Unable to create this Dream.");
			}
		}
	}

	// Creates one nested folder in the active work's Dream library.
	public async CreateFolderAsync(parentPath: string, name: string): Promise<boolean>
	{
		const document = this.library.GetText();
		let created = false;

		if (document !== null)
		{
			try
			{
				const folder = await this.gateway.CreateFolderAsync({
					workId: document.id,
					parentPath,
					name
				});
				this.store.AddFolder(folder);
				await this.events.PublishAsync("dream.catalogue-changed", { count: this.store.GetCatalogue().length });
				created = true;
			}
			catch (error)
			{
				this.errors.Report("DreamExplorerController", error, "Unable to create folder");
			}
		}

		return created;
	}

	// Deletes one empty Dream folder from the active work.
	public async DeleteFolderAsync(folderPath: string): Promise<boolean>
	{
		const document = this.library.GetText();
		let deleted = false;

		if (document !== null)
		{
			try
			{
				await this.gateway.DeleteFolderAsync({ workId: document.id, folderPath });
				this.store.RemoveFolder(document.id, folderPath);
				await this.events.PublishAsync("dream.catalogue-changed", { count: this.store.GetCatalogue().length });
				deleted = true;
			}
			catch (error)
			{
				this.errors.Report("DreamExplorerController", error, "Unable to delete folder");
			}
		}

		return deleted;
	}

	// Moves one or more selected Dreams to a folder within their owning work.
	public async MoveDreamsAsync(dreamIds: readonly string[], folderPath: string): Promise<boolean>
	{
		let succeeded = true;
		let changed = false;

		try
		{
			for (const dreamId of dreamIds)
			{
				if (this.store.GetDreamFolder(dreamId) !== folderPath)
				{
					const location = await this.gateway.MoveDreamAsync({ dreamId, folderPath });
					this.store.SetDreamLocation(location);
					changed = true;
				}
			}
		}
		catch (error)
		{
			succeeded = false;
			this.errors.Report("DreamExplorerController", error, "Unable to move Dream");
		}

		if (changed) await this.events.PublishAsync("dream.catalogue-changed", { count: this.store.GetCatalogue().length });

		return succeeded;
	}

	// Routes a create-requested application event to the DreamView creation workflow.
	private async HandleCreateRequested(event: ChoraEvents["dream.create-requested"]): Promise<void>
	{
		await this.CreateDreamAsync(event.selection);
	}

	// Releases the Explorer's creation subscription.
	public Dispose(): void
	{
		this.unsubscribe();
	}
}

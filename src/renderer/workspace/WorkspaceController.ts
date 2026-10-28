import type { ApiSubscription } from "../../shared/contracts/ChoraApi.js";
import type { ChoraEventBus, Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import type { DreamCatalogueController } from "../dreams/DreamCatalogueController.js";
import type { DreamSaveCoordinator } from "../dreams/DreamSaveCoordinator.js";
import type { DreamStore } from "../dreams/DreamStore.js";
import type { LibraryController } from "../library/LibraryController.js";
import type { LibraryGateway } from "../library/LibraryGateway.js";
import type { LibraryStore } from "../library/LibraryStore.js";
import type { DreamExplorerController } from "./DreamExplorerController.js";

// Coordinates activation, blur saving, and workspace requests without owning DOM or feature state.
export class WorkspaceController
{
	// Typed workspace subscriptions owned by this workflow coordinator.
	private readonly subscriptions: Unsubscribe[] = [];
	// Native Library-selection subscription owned by this workflow coordinator.
	private selectionSubscription: ApiSubscription | null = null;

	// Uses feature owners directly; catalogue, edits, and persistence remain with their existing authorities.
	public constructor(events: ChoraEventBus<ChoraEvents>, private readonly store: DreamStore, private readonly libraryStore: LibraryStore, private readonly library: LibraryController, private readonly reader: LibraryGateway, private readonly catalogue: DreamCatalogueController, private readonly saves: DreamSaveCoordinator, private readonly explorer: DreamExplorerController)
	{
		this.subscriptions.push(events.Subscribe("workspace.focused", this.HandleFocusAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("workspace.blurred", this.HandleBlurAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("workspace.save-requested", this.HandleSaveAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("workspace.create-dream-requested", this.HandleCreateAsync.bind(this)));
	}

	// Attaches the native Library-selection workflow after application composition has mounted the reader.
	public Start(): void
	{
		if (this.selectionSubscription === null) this.selectionSubscription = this.reader.SubscribeToSelection(this.HandleTextSelectedAsync.bind(this));
	}

	// Releases workflow subscriptions in the same lifecycle as the composed application.
	public Dispose(): void
	{
		this.selectionSubscription?.();
		this.selectionSubscription = null;
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
	}

	// Preserves the existing focus behavior without introducing automatic filesystem scans.
	private async HandleFocusAsync(): Promise<void>
	{
		if (this.store.GetActiveDream() === null) await this.catalogue.RefreshAsync();
	}

	// Delegates blur persistence only when the DOM owner permits it.
	private async HandleBlurAsync(event: ChoraEvents["workspace.blurred"]): Promise<void>
	{
		if (event.canSave) await this.saves.SaveAsync();
	}

	// Runs the explicit save shortcut through the persistence owner.
	private async HandleSaveAsync(): Promise<void>
	{
		if (this.store.GetActiveDream() !== null) await this.saves.SaveAsync();
	}

	// Resolves the current source selection before requesting Dream creation from its owning workflow.
	private async HandleCreateAsync(): Promise<void>
	{
		const selection = this.libraryStore.GetSelection();
		if (selection !== null) await this.explorer.CreateDreamAsync(selection);
	}

	// Opens the canonical work selected by the main process without bypassing the Library owner.
	private async HandleTextSelectedAsync(textId: string): Promise<void>
	{
		await this.library.OpenAsync(textId);
	}
}

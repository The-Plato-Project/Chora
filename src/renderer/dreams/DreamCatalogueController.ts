import { CreateDreamView } from "./DreamView.js";
import type { DreamView } from "./DreamView.js";
import type { TextDocument } from "../../shared/library/LibraryTypes.js";
import type { ChoraEvents } from "../core/events/ChoraEvents.js";
import { ChoraEventBus } from "../core/events/ChoraEventBus.js";
import { ErrorManager } from "../core/diagnostics/RendererErrorManager.js";
import { LibraryStore } from "../library/LibraryStore.js";
import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { DreamGateway } from "./DreamGateway.js";
import { DreamStore } from "./DreamStore.js";

import type { Unsubscribe } from "../core/events/ChoraEventBus.js";
import type { DreamSaveCoordinator } from "./DreamSaveCoordinator.js";
// A division of a document (e.g. "Book 4"), used to place a Dream in the catalogue.
type DreamDivision = { type: string; label: string };

// A group of catalogue Dreams presented under one division heading, or one ungrouped list when no division data exists.
export interface DreamCatalogueGroup
{
	// Display heading for the group, or empty when Dreams are not grouped by division.
	readonly label: string;
	// Identifier of the book division this group belongs to, or null when this is not a book-level group.
	readonly book: string | null;
	// Dreams belonging to this group, already ordered by source position.
	readonly dreams: readonly DreamView[];
}


// Owns catalogue loading, explicit reconciliation, passage filtering, and grouped projections.
export class DreamCatalogueController
{
	// One refresh shared by all concurrent catalogue consumers.
	private activeRefresh: Promise<boolean> | null = null;
	// Feature subscriptions released when this catalogue owner is disposed.
	private readonly subscriptions: Unsubscribe[] = [];

	// Uses existing state and coordinates reload with the save owner.
	public constructor(private readonly events: ChoraEventBus<ChoraEvents>, private readonly errors: ErrorManager, private readonly library: LibraryStore, private readonly store: DreamStore, private readonly gateway: DreamGateway, private readonly saves: DreamSaveCoordinator)
	{
		this.subscriptions.push(events.Subscribe("dream.passage-filter-requested", this.HandlePassageFilterRequestedAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("library.text-opened", this.HandleFilterTextOpened.bind(this)));
	}

	// Resolves a clicked passage against the current work before applying its source filter.
	private async HandlePassageFilterRequestedAsync(event: ChoraEvents["dream.passage-filter-requested"]): Promise<void>
	{
		const document = this.library.GetText();
		if (document !== null && document.id === event.workId)
		{
			for (const segment of document.segments)
			{
				if (segment.key === event.segmentKey && segment.citation !== null)
				{
					const label = `${document.title} · ${segment.citation.value}`;
					this.store.SetPassageFilter({ workId: document.id, segmentKey: segment.key, label });
					this.store.SetSearchText("");
					await this.events.PublishAsync("dream.passage-filter-changed", {});
					break;
				}
			}
		}
	}

	// Refreshes the catalogue and removes stale filters when a text opens.
	private HandleFilterTextOpened(): void
	{
		this.store.SetSearchText("");
		const filter = this.store.GetPassageFilter();
		const text = this.library.GetText();
		if (filter !== null && filter.workId !== text?.id)
		{
			void this.ClearPassageFilterAsync();
		}
		void this.RefreshAsync();
	}

	// Clears source filtering while retaining any keyword query entered within it.
	public async ClearPassageFilterAsync(): Promise<void>
	{
		this.store.SetPassageFilter(null);
		await this.events.PublishAsync("dream.passage-filter-changed", {});
	}

	// Supplies per-passage counts for the reading pane without exposing catalogue ownership.
	public GetPassageCounts(): ReadonlyMap<string, number>
	{
		const document = this.library.GetText();
		let counts: ReadonlyMap<string, number> = new Map<string, number>();
		if (document !== null)
		{
			counts = this.store.GetPassageCounts(document);
		}
		return counts;
	}

	// Supplies associated DreamView titles for reading-pane passage tooltips.
	public GetPassageDreamTitles(): ReadonlyMap<string, readonly string[]>
	{
		const document = this.library.GetText();
		let titles: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>();
		if (document !== null)
		{
			titles = this.store.GetPassageDreamTitles(document);
		}
		return titles;
	}

	// Reloads the DreamView catalogue from the main process and publishes a change notice when it differs.
	public async RefreshAsync(): Promise<boolean>
	{
		if (this.activeRefresh === null)
		{
			this.activeRefresh = this.PerformRefreshAsync();
		}

		const refresh = this.activeRefresh;
		const completed = await refresh;

		if (this.activeRefresh === refresh)
		{
			this.activeRefresh = null;
		}

		return completed;
	}

	// Applies an explicit disk reload only when every editor is settled, preserving all local drafts.
	public async ReloadFromDiskAsync(): Promise<void>
	{
		if (this.activeRefresh !== null) await this.activeRefresh;
		if (this.store.HasUnsavedChanges() || this.saves.IsBusy())
		{
			throw new Error("Reload would conflict with unsaved edits. Finish saving, then reload. Your edits have been kept.");
		}
		const snapshot = await this.gateway.ReloadAsync();
		const catalogue = this.CreateViews(snapshot.dreams);
		this.store.ApplyReload(catalogue, snapshot.folders, snapshot.locations);
		await this.events.PublishAsync("dream.catalogue-changed", { count: catalogue.length });
		if (this.store.GetActiveDream() === null) await this.events.PublishAsync("dream.closed", {});
		else await this.events.PublishAsync("dream.opened", {});
	}

	// Performs one canonical catalogue read and publishes a change only when records differ.
	private async PerformRefreshAsync(): Promise<boolean>
	{
		let completed = false;
		try
		{
			const snapshot = await this.gateway.ListAsync();
			const catalogue = this.CreateViews(snapshot.dreams);
			const current = {
				dreams: this.store.GetCatalogue(),
				...this.store.GetFolderState()
			};
			const next = {
				dreams: catalogue,
				folders: snapshot.folders,
				locations: snapshot.locations
			};
			const hasChanged = JSON.stringify(current) !== JSON.stringify(next);

			if (hasChanged)
			{
				this.store.SetCatalogue(catalogue, snapshot.folders, snapshot.locations);
				await this.events.PublishAsync("dream.catalogue-changed", { count: catalogue.length });
			}
			completed = true;
		}
		catch (error)
		{
			const message = "Unable to refresh Dreams";
			this.errors.Report("DreamCatalogueController", error, message);
		}

		return completed;
	}

	// Returns the reader's visible DreamView catalogue, grouped by division when division data is available.
	public GetCatalogueGroups(searchText: string): DreamCatalogueGroup[]
	{
		const document = this.library.GetText();
		const dreams = this.store.GetVisibleCatalogue(searchText, document);
		const divisions = this.FindDivisions(dreams);
		const hasDivisions = this.HasAnyDivision(divisions);
		let groups: DreamCatalogueGroup[] = [];

		if (dreams.length > 0) groups = hasDivisions ? this.GroupByDivision(dreams, divisions) : [{ label: "", book: null, dreams }];

		return groups;
	}

	// Resolves a collection of serialized Dreams for renderer display.
	private CreateViews(snapshots: readonly DreamSnapshot[]): DreamView[]
	{
		const views: DreamView[] = [];

		for (const snapshot of snapshots)
		{
			const view = CreateDreamView(snapshot);
			views.push(view);
		}

		return views;
	}

	// Finds the division of each DreamView, in the same order, using its recorded division or a document lookup.
	private FindDivisions(dreams: readonly DreamView[]): (DreamDivision | null)[]
	{
		const divisions: (DreamDivision | null)[] = [];

		for (const dream of dreams) divisions.push(this.FindDivision(dream));

		return divisions;
	}

	// Returns whether any division in the given list is present.
	private HasAnyDivision(divisions: readonly (DreamDivision | null)[]): boolean
	{
		let hasDivision = false;

		for (const division of divisions)
		{
			if (division !== null)
			{
				hasDivision = true;
				break;
			}
		}

		return hasDivision;
	}

	// Returns a DreamView's recorded division, falling back to a lookup in its currently open source document.
	private FindDivision(dream: DreamView): DreamDivision | null
	{
		let division: DreamDivision | null = null;
		const document = this.library.GetText();

		if (division === null && document?.id === dream.workId) division = this.FindSegmentDivision(document, dream);

		return division;
	}

	// Finds the division of the source segment matching a DreamView's start segment key, falling back to its locator.
	private FindSegmentDivision(document: TextDocument, dream: DreamView): DreamDivision | null
	{
		let division: DreamDivision | null = null;

		for (const segment of document.segments)
		{
			if (segment.key === dream.source.start.segmentKey)
			{
				division = segment.division ?? null;
				break;
			}
		}

		return division;
	}

	// Groups Dreams by owning work and division, preserving each group's first-seen order.
	private GroupByDivision(dreams: readonly DreamView[], divisions: readonly (DreamDivision | null)[]): DreamCatalogueGroup[]
	{
		const groups = new Map<string, { label: string; book: string | null; dreams: DreamView[] }>();

		for (let index = 0; index < dreams.length; index += 1)
		{
			const dream = dreams[index];
			const division = divisions[index] ?? null;

			if (dream !== undefined)
			{
				const key = division === null ? `${dream.workId}:unplaced` : `${dream.workId}:${division.type}:${division.label}`;
				let group = groups.get(key);

				if (group === undefined)
				{
					const label = division === null ? "Unplaced" : this.FormatDivisionLabel(division.type, division.label);
					const book = division?.type === "book" ? division.label : null;
					group = { label, book, dreams: [] };
					groups.set(key, group);
				}

				group.dreams.push(dream);
			}
		}

		const result: DreamCatalogueGroup[] = [];

		for (const group of groups.values()) result.push(group);

		return result;
	}

	// Formats a division as a reader-facing heading (e.g. "Book 4").
	private FormatDivisionLabel(kind: string, value: string): string
	{
		const kindLabel = `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
		const label = `${kindLabel} ${value}`;

		return label;
	}

	// Releases feature-owned event subscriptions without creating another catalogue cache.
	public Dispose(): void
	{
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.length = 0;
	}
}

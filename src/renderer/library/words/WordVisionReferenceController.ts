import type { VisionSnapshot } from "../../../shared/visions/VisionTypes.js";
import type { TextAnchorGateway } from "../../anchors/TextAnchorGateway.js";
import type { ErrorManager } from "../../core/diagnostics/RendererErrorManager.js";
import type { ChoraEventBus, Unsubscribe } from "../../core/events/ChoraEventBus.js";
import type { ChoraEvents } from "../../core/events/ChoraEvents.js";
import type { VisionStore } from "../../visions/VisionStore.js";
import type { LibraryStore } from "../LibraryStore.js";
import type { WordExplorationStore } from "./WordExplorationStore.js";
import { WordVisionReferenceStore, type WordVisionReferenceRecord } from "./WordVisionReferenceStore.js";

// Reconciles exact reader placements without treating prose as a reference change.
export class WordVisionReferenceController
{
	// Feature subscriptions released at disposal.
	private readonly subscriptions: Unsubscribe[] = [];
	// Coalesces concurrent anchor requests for the same work.
	private readonly loads = new Map<string, Promise<void>>();
	// Work represented by the currently active lookup evidence.
	private activeWorkId: string | null = null;
	// Invalidates anchor responses across catalogue replacement and disposal.
	private epoch = 0;
	// Invalidates active-lookup reconciliation when the lookup closes or changes works.
	private generation = 0;
	// Prevents late requests from restoring disposed projections.
	private isDisposed = false;

	// Uses authoritative Vision writing and anchors to maintain a rebuildable projection.
	public constructor(
		private readonly events: ChoraEventBus<ChoraEvents>,
		private readonly errors: ErrorManager,
		private readonly words: WordExplorationStore,
		private readonly visions: VisionStore,
		private readonly anchors: TextAnchorGateway,
		private readonly library: LibraryStore,
		private readonly references: WordVisionReferenceStore)
	{
		this.subscriptions.push(events.Subscribe("word.exploration-changed", this.RefreshAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.references-changed", this.HandleReferencesChangedAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.reference-context-changed", this.HandleReferencesChangedAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.metadata-changed", this.HandleMetadataChangedAsync.bind(this)));
		this.subscriptions.push(events.Subscribe("vision.catalogue-changed", this.HandleCatalogueChangedAsync.bind(this)));
	}

	// Invalidates pending responses and releases feature listeners.
	public Dispose(): void
	{
		this.isDisposed = true;
		this.epoch += 1;
		this.generation += 1;
		for (const unsubscribe of this.subscriptions)
		{
			unsubscribe();
		}
		this.subscriptions.length = 0;
		this.loads.clear();
	}

	// Rebuilds from current Markdown projections when a work first becomes visible.
	private async RefreshAsync(): Promise<void>
	{
		const evidence = this.words.GetSnapshot().evidence;
		const workId = evidence?.work?.dialogue ?? evidence?.selection?.dialogue ?? null;
		if (workId !== this.activeWorkId || (workId !== null && this.references.GetState(workId) === "error"))
		{
			this.activeWorkId = workId;
			const generation = ++this.generation;
			if (workId !== null && !this.isDisposed)
			{
				try
				{
					if (!this.references.HasAnchors(workId))
					{
						this.references.SetLoading(workId);
						await this.events.PublishAsync("word.vision-references-changed", { workId, selectionKeys: null });
					}
					await this.EnsureAnchorsAsync(workId, []);
					// Include anchors created while the initial IPC request was in flight.
					const anchorIds: string[] = [];
					for (const vision of this.visions.GetCatalogue(workId))
					{
						const placements = this.visions.GetReferences(vision.id);
						for (const placement of placements)
						{
							anchorIds.push(placement.anchorId);
						}
					}
					if (generation === this.generation && !this.isDisposed)
					{
						await this.EnsureAnchorsAsync(workId, anchorIds);
					}
					if (generation === this.generation && !this.isDisposed)
					{
						const records: WordVisionReferenceRecord[] = [];
						for (const vision of this.visions.GetCatalogue(workId))
						{
							const placements = this.BuildRecords(vision);
							records.push(...placements);
						}
						const state = this.references.GetState(workId);
						const keys = this.references.Set(workId, records);
						await this.PublishChangesAsync(workId, keys, state !== "ready");
					}
				}
				catch (error)
				{
					if (generation === this.generation && !this.isDisposed)
					{
						await this.ReportFailureAsync(workId, error);
					}
				}
			}
		}
	}

	// Reacts only to actual placement changes, including removal and undo.
	private async HandleReferencesChangedAsync(event: ChoraEvents["vision.references-changed"] | ChoraEvents["vision.reference-context-changed"]): Promise<void>
	{
		if (this.references.HasAnchors(event.workId))
		{
			try
			{
				const epoch = this.epoch;
				await this.EnsureAnchorsAsync(event.workId, event.anchorIds);
				if (epoch === this.epoch && !this.isDisposed)
				{
					await this.UpdateVisionAsync(event.workId, event.visionId);
				}
			}
			catch (error)
			{
				if (!this.isDisposed)
				{
					await this.ReportFailureAsync(event.workId, error);
				}
			}
		}
	}

	// A title change updates link labels; save timestamps never invalidate relationships.
	private async HandleMetadataChangedAsync(event: ChoraEvents["vision.metadata-changed"]): Promise<void>
	{
		if (event.titleChanged && this.references.HasAnchors(event.workId) && !this.isDisposed)
		{
			await this.UpdateVisionAsync(event.workId, event.visionId);
		}
	}

	// Reconciles membership changes without rescanning unrelated Vision Markdown.
	private async HandleCatalogueChangedAsync(event: ChoraEvents["vision.catalogue-changed"]): Promise<void>
	{
		if (event.kind === "reset")
		{
			this.epoch += 1;
			this.loads.clear();
			this.references.InvalidateAnchors();
			this.activeWorkId = null;
			await this.RefreshAsync();
		}
		else if ((event.kind === "created" || event.kind === "deleted" || event.kind === "moved")
			&& this.references.HasAnchors(event.workId) && !this.isDisposed)
		{
			await this.UpdateVisionAsync(event.workId, event.visionId);
		}
	}

	// Re-reads the current document after awaits so late events cannot restore old writing.
	private async UpdateVisionAsync(workId: string, visionId: string): Promise<void>
	{
		const vision = this.visions.Get(visionId);
		const records = vision === null ? [] : this.BuildRecords(vision);
		const state = this.references.GetState(workId);
		const keys = this.references.ReplaceVision(workId, visionId, records);
		await this.PublishChangesAsync(workId, keys, state !== "ready");
	}

	// Joins exact anchors to the store's current derived placements, including unsaved writing.
	private BuildRecords(vision: VisionSnapshot): readonly WordVisionReferenceRecord[]
	{
		const records: WordVisionReferenceRecord[] = [];
		const document = this.library.GetText();
		if (document === null || document.id !== vision.workId)
		{
			throw new Error(`The canonical text for ${vision.workId} is not open.`);
		}
		const placements = this.visions.GetReferences(vision.id);
		for (const placement of placements)
		{
			const anchor = this.references.GetAnchor(vision.workId, placement.anchorId);
			if (anchor !== null)
			{
				if (document.ReconstructText(anchor.selection) !== anchor.selectedText)
				{
					throw new Error(`Vision anchor ${anchor.id} no longer matches the canonical text.`);
				}
				const selections = anchor.kind === "word"
					? [anchor.selection]
					: document.GetGreekWordSelections(anchor.selection);
				for (const selection of selections)
				{
					records.push({
						selection,
						reference: { visionId: vision.id, visionTitle: vision.title || "Untitled Vision", placementId: placement.id,
							excerpt: this.visions.GetReferenceExcerpt(vision.id, placement.id) }
					});
				}
			}
		}
		return records;
	}

	// Acquires anchors once per work, refreshing only for newly referenced identities.
	private async EnsureAnchorsAsync(workId: string, anchorIds: readonly string[]): Promise<void>
	{
		const pending = this.loads.get(workId);
		if (pending !== undefined)
		{
			await pending;
		}
		let missing = !this.references.HasAnchors(workId);
		for (const anchorId of anchorIds)
		{
			if (this.references.GetAnchor(workId, anchorId) === null)
			{
				missing = true;
			}
		}
		if (missing && !this.isDisposed)
		{
			const load = this.LoadAnchorsAsync(workId, this.epoch);
			this.loads.set(workId, load);
			try
			{
				await load;
			}
			finally
			{
				if (this.loads.get(workId) === load)
				{
					this.loads.delete(workId);
				}
			}
		}
	}

	// Installs an authoritative anchor response only for its live catalogue epoch.
	private async LoadAnchorsAsync(workId: string, epoch: number): Promise<void>
	{
		const anchors = await this.anchors.ListAsync(workId);
		if (epoch === this.epoch && !this.isDisposed)
		{
			this.references.SetAnchors(workId, anchors);
		}
	}

	// Leaves unrelated occurrence DOM intact and suppresses identical results.
	private async PublishChangesAsync(workId: string, keys: readonly string[], availabilityChanged: boolean): Promise<void>
	{
		if (availabilityChanged || keys.length > 0)
		{
			const selectionKeys = availabilityChanged ? null : keys;
			await this.events.PublishAsync("word.vision-references-changed", { workId, selectionKeys });
		}
	}

	// Retains usable links while reporting a failed anchor reconciliation once.
	private async ReportFailureAsync(workId: string, error: unknown): Promise<void>
	{
		this.references.SetError(workId);
		await this.events.PublishAsync("word.vision-references-changed", { workId, selectionKeys: null });
		this.errors.Report("WordVisionReferenceController", error, "Linked Visions could not be loaded.");
	}
}

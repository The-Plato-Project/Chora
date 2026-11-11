import type { VisionCatalogueSnapshot, VisionFolderSnapshot, VisionSnapshot } from "../../shared/visions/VisionTypes.js";
import { CreateVisionReferenceExcerpts, FindVisionReferenceRanges } from "../../shared/visions/VisionReferenceMarkdown.js";
import type { VisionReferencePlacement } from "../../shared/visions/VisionReferenceTypes.js";

// Persistence status of one independently edited Vision.
export type VisionSaveState = "saved" | "dirty" | "saving" | "error";

// Reader-selected editor presentation, independent of document writing.
export type VisionMode = "write" | "markdown" | "preview";

// Consequences of a store mutation, independent of whichever tab is active.
export interface VisionChange
{
	// Identity of the changed document.
	readonly visionId: string;
	// Work whose projections may be affected.
	readonly workId: string;
	// Current local document revision.
	readonly revision: number;
	// Whether the title displayed by other features changed.
	readonly titleChanged: boolean;
	// Whether catalogue ordering metadata changed.
	readonly updatedAtChanged: boolean;
	// Whether the unsaved indicator changed.
	readonly dirtyChanged: boolean;
	// Whether persistence status changed.
	readonly saveStateChanged: boolean;
	// Anchor identities whose placement membership changed.
	readonly referenceAnchorIds: readonly string[];
	// Anchors whose placement context changed without a relationship membership change.
	readonly contextAnchorIds: readonly string[];
}

// Authoritative writing and its rebuildable reference projection.
interface VisionRecord
{
	// Current Markdown document snapshot.
	vision: VisionSnapshot;
	// Placements derived from this snapshot, never persisted separately.
	references: readonly VisionReferencePlacement[];
	// Plain-text placement context derived together with the reference projection.
	excerpts: ReadonlyMap<string, string>;
	// Revision advanced by local writing changes.
	revision: number;
	// Last successfully persisted local revision.
	savedRevision: number;
	// Current persistence operation state.
	saveState: VisionSaveState;
}

// Immutable document-tab projection independent of Markdown content.
export interface VisionTab
{
	// Stable document identity.
	readonly visionId: string;
	// Label displayed in the shared editor strip.
	readonly title: string;
	// Whether the document contains unsaved writing.
	readonly isDirty: boolean;
}

// Durable document membership; writing remains in authoritative Markdown files.
export interface VisionTabsSnapshot
{
	// Open documents in their saved order.
	readonly openVisionIds: readonly string[];
	// Most recently selected Vision.
	readonly activeVisionId: string | null;
	readonly modes?: Readonly<Record<string, VisionMode>>;
}

// Owns renderer Vision writing, revisions, and rebuildable document projections.
export class VisionStore
{
	// Authoritative renderer documents indexed by stable identity.
	private readonly records = new Map<string, VisionRecord>();
	private readonly folders = new Map<string, VisionFolderSnapshot>();
	// Open Vision identities restored for the current session.
	private openIds: string[] = [];
	// Selected Vision identity or null when none is open.
	private activeId: string | null = null;
	private readonly modes = new Map<string, VisionMode>();
	// Reconciles saved membership against the current authoritative catalogue.
	public RestoreTabs(state: VisionTabsSnapshot): void
	{
		this.openIds = [...new Set(state.openVisionIds)].filter(this.records.has.bind(this.records));
		this.activeId = state.activeVisionId !== null && this.openIds.includes(state.activeVisionId)
			? state.activeVisionId : this.openIds[0] ?? null;
		this.modes.clear();
		for (const id of this.openIds)
		{
			const mode = state.modes?.[id];
			if (mode !== undefined) this.modes.set(id, mode);
		}
	}

	// Projects only inexpensive resume metadata, never document contents.
	public GetTabsState(): VisionTabsSnapshot
	{
		const modes: Record<string, VisionMode> = {};
		for (const id of this.openIds) modes[id] = this.GetEditorMode(id);
		return { openVisionIds: [...this.openIds], activeVisionId: this.activeId, modes };
	}

	public GetEditorMode(visionId: string): VisionMode
	{
		return this.modes.get(visionId) ?? "write";
	}

	public SetEditorMode(visionId: string, mode: VisionMode): void
	{
		this.Require(visionId);
		this.modes.set(visionId, mode);
	}

	// Replaces the catalogue and reconciles open document identities.
	public SetCatalogue(catalogue: VisionCatalogueSnapshot): void
	{
		this.records.clear();
		this.folders.clear();
		for (const vision of catalogue.visions)
		{
			const record = this.CreateRecord(vision);
			this.records.set(vision.id, record);
		}
		for (const folder of catalogue.folders)
		{
			this.folders.set(this.FolderKey(folder.workId, folder.path), folder);
		}
		const candidates = this.openIds;
		const activeId = this.activeId;
		const openIds: string[] = [];
		for (const visionId of candidates)
		{
			if (this.records.has(visionId))
			{
				openIds.push(visionId);
			}
		}
		this.openIds = openIds;
		this.activeId = activeId !== null && openIds.includes(activeId) ? activeId : openIds[0] ?? null;
	}

	public GetFolders(workId?: string): readonly VisionFolderSnapshot[]
	{
		return [...this.folders.values()]
			.filter((folder) => workId === undefined || folder.workId === workId)
			.sort((first, second) => first.path.localeCompare(second.path));
	}

	// Returns current documents ordered by their persisted update time.
	public GetCatalogue(workId?: string): readonly VisionSnapshot[]
	{
		const visions: VisionSnapshot[] = [];
		for (const record of this.records.values())
		{
			if (workId === undefined || record.vision.workId === workId)
			{
				visions.push(record.vision);
			}
		}
		visions.sort(function CompareVisions(first, second): number
		{
			const order = second.updatedAt.localeCompare(first.updatedAt);
			return order;
		});
		return visions;
	}

	// Resolves one document without sorting the entire catalogue.
	public Get(visionId: string): VisionSnapshot | null
	{
		const vision = this.records.get(visionId)?.vision ?? null;
		return vision;
	}

	// Returns placements derived from the current, including unsaved, Markdown.
	public GetReferences(visionId: string): readonly VisionReferencePlacement[]
	{
		const record = this.Require(visionId);
		const references = structuredClone(record.references);
		return references;
	}

	// Reads context without reparsing a Vision during lookup rendering.
	public GetReferenceExcerpt(visionId: string, placementId: string): string
	{
		const record = this.Require(visionId);
		const excerpt = record.excerpts.get(placementId) ?? "";
		return excerpt;
	}

	// Opens and activates a document without changing its writing revision.
	public Open(visionId: string): VisionSnapshot
	{
		const record = this.Require(visionId);
		if (!this.openIds.includes(visionId))
		{
			this.openIds.push(visionId);
		}
		this.activeId = visionId;
		return record.vision;
	}

	// Activates a document already present in the editor strip.
	public Activate(visionId: string): VisionSnapshot
	{
		if (!this.openIds.includes(visionId))
		{
			throw new Error("The Vision tab is not open.");
		}
		const record = this.Require(visionId);
		this.activeId = visionId;
		return record.vision;
	}

	// Removes document membership while retaining its catalogue writing.
	public Close(visionId: string): VisionSnapshot | null
	{
		const index = this.openIds.indexOf(visionId);
		if (index >= 0)
		{
			this.openIds.splice(index, 1);
		}
		if (this.activeId === visionId)
		{
			const nextId = this.openIds[Math.min(index, this.openIds.length - 1)] ?? null;
			this.activeId = nextId;
		}
		const active = this.GetActive();
		return active;
	}

	// Reads the selected document without cloning or sorting the catalogue.
	public GetActive(): VisionSnapshot | null
	{
		const active = this.activeId === null ? null : this.Get(this.activeId);
		return active;
	}

	// Projects tab labels and dirty state without exposing mutable records.
	public GetOpenTabs(): readonly VisionTab[]
	{
		const tabs: VisionTab[] = [];
		for (const visionId of this.openIds)
		{
			const record = this.Require(visionId);
			tabs.push({
				visionId,
				title: record.vision.title || "Untitled Vision",
				isDirty: record.revision !== record.savedRevision
			});
		}
		return tabs;
	}

	// Adds a newly persisted document without replacing existing unsaved writing.
	public AddSaved(vision: VisionSnapshot): void
	{
		if (this.records.has(vision.id))
		{
			throw new Error("The Vision already exists in the catalogue.");
		}
		const record = this.CreateRecord(vision);
		this.records.set(vision.id, record);
	}

	public AddFolder(folder: VisionFolderSnapshot): void
	{
		const key = this.FolderKey(folder.workId, folder.path);
		if (this.folders.has(key)) throw new Error("The Vision folder already exists.");
		this.folders.set(key, folder);
	}

	public RemoveFolder(workId: string, folderPath: string): void
	{
		this.folders.delete(this.FolderKey(workId, folderPath));
	}

	public Move(vision: VisionSnapshot): void
	{
		const record = this.Require(vision.id);
		record.vision = vision;
	}

	// Updates writing immediately and describes only observable changes.
	public Update(visionId: string, change: Partial<Pick<VisionSnapshot, "title" | "markdown">>): VisionChange | null
	{
		const record = this.Require(visionId);
		const next = { ...record.vision, ...change };
		let result: VisionChange | null = null;
		if (next.title !== record.vision.title || next.markdown !== record.vision.markdown)
		{
			const previous = { ...record };
			record.revision += 1;
			record.vision = next;
			record.saveState = "dirty";
			if (next.markdown !== previous.vision.markdown)
			{
				const projection = this.ReadReferences(next);
				record.references = projection.references;
				record.excerpts = projection.excerpts;
			}
			result = this.DescribeChange(previous, record);
		}
		return result;
	}

	// Reads the local revision captured by a save operation.
	public GetRevision(visionId: string): number
	{
		const record = this.Require(visionId);
		return record.revision;
	}

	// Reports whether the current revision has been persisted.
	public IsDirty(visionId: string): boolean
	{
		const record = this.Require(visionId);
		const dirty = record.revision !== record.savedRevision;
		return dirty;
	}

	// Reads persistence status for the captured document identity.
	public GetSaveState(visionId: string): VisionSaveState
	{
		const record = this.Require(visionId);
		return record.saveState;
	}

	// Reports whether a persistence-state transition actually occurred.
	public SetSaveState(visionId: string, state: VisionSaveState): boolean
	{
		const record = this.Require(visionId);
		const changed = record.saveState !== state;
		record.saveState = state;
		return changed;
	}

	// Applies a captured save without replacing newer unsaved writing.
	public MarkSaved(visionId: string, saved: VisionSnapshot, revision: number): VisionChange
	{
		const record = this.Require(visionId);
		const previous = { ...record };
		record.vision = record.revision === revision
			? saved
			: { ...record.vision, updatedAt: saved.updatedAt };
		record.savedRevision = revision;
		record.saveState = record.revision === revision ? "saved" : "dirty";
		if (record.vision.markdown !== previous.vision.markdown)
		{
			const projection = this.ReadReferences(record.vision);
			record.references = projection.references;
			record.excerpts = projection.excerpts;
		}
		const change = this.DescribeChange(previous, record);
		return change;
	}

	// Builds the initial document record from authoritative Markdown.
	private CreateRecord(vision: VisionSnapshot): VisionRecord
	{
		const projection = this.ReadReferences(vision);
		const record: VisionRecord = { vision, ...projection, revision: 0, savedRevision: 0, saveState: "saved" };
		return record;
	}

	// Extracts placements from authoritative Markdown without relying on a reverse index.
	private ReadReferences(vision: VisionSnapshot): Pick<VisionRecord, "references" | "excerpts">
	{
		const ranges = FindVisionReferenceRanges(vision.markdown);
		const references: VisionReferencePlacement[] = [];
		for (const range of ranges)
		{
			references.push(range.placement);
		}
		const excerpts = CreateVisionReferenceExcerpts(vision.markdown, ranges);
		return { references, excerpts };
	}

	// Compares relationship identities rather than prose offsets or reference order.
	private DescribeChange(previous: VisionRecord, current: VisionRecord): VisionChange
	{
		const before = new Map<string, string>();
		const after = new Map<string, string>();
		const anchorIds = new Set<string>();
		const contextAnchorIds = new Set<string>();
		if (previous.references !== current.references)
		{
			for (const reference of previous.references)
			{
				before.set(reference.id, reference.anchorId);
			}
			for (const reference of current.references)
			{
				after.set(reference.id, reference.anchorId);
				if (previous.excerpts.get(reference.id) !== current.excerpts.get(reference.id)) contextAnchorIds.add(reference.anchorId);
				if (before.get(reference.id) !== reference.anchorId)
				{
					anchorIds.add(reference.anchorId);
				}
			}
			for (const reference of previous.references)
			{
				if (after.get(reference.id) !== reference.anchorId)
				{
					anchorIds.add(reference.anchorId);
				}
			}
		}
		const change: VisionChange = {
			visionId: current.vision.id,
			workId: current.vision.workId,
			revision: current.revision,
			titleChanged: previous.vision.title !== current.vision.title,
			updatedAtChanged: previous.vision.updatedAt !== current.vision.updatedAt,
			dirtyChanged: (previous.revision !== previous.savedRevision) !== (current.revision !== current.savedRevision),
			saveStateChanged: previous.saveState !== current.saveState,
			referenceAnchorIds: [...anchorIds],
			contextAnchorIds: [...contextAnchorIds]
		};
		return change;
	}

	// Removes a document after its main-process deletion succeeds.
	public Remove(visionId: string): void
	{
		this.Close(visionId);
		this.records.delete(visionId);
		this.modes.delete(visionId);
	}

	// Rejects mutation of an identity absent from the authoritative catalogue.
	private Require(visionId: string): VisionRecord
	{
		const record = this.records.get(visionId);
		if (record === undefined)
		{
			throw new Error("The Vision is not available.");
		}
		return record;
	}

	private FolderKey(workId: string, folderPath: string): string
	{
		return `${workId}\u0000${folderPath}`;
	}

}

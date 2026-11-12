import type { TextAnchorSnapshot } from "../../../shared/anchors/TextAnchorTypes.js";
import type { TextSelection } from "../../../shared/text/TextSelection.js";

// One reader-authored placement linked to an exact source occurrence.
export interface WordVisionReference
{
	// Containing document identity.
	readonly visionId: string;
	// Current reader-authored document title.
	readonly visionTitle: string;
	// Stable placement to focus when opening the document.
	readonly placementId: string;
	// Reader prose surrounding this placement, derived from current Vision Markdown.
	readonly excerpt?: string;
}

// Resolved placement used to rebuild the reverse projection.
export interface WordVisionReferenceRecord
{
	// Versioned source occurrence resolved from its authoritative anchor.
	readonly selection: TextSelection;
	// Document and placement reached from that occurrence.
	readonly reference: WordVisionReference;
}

// Availability of a work's reverse projection.
export type WordVisionReferenceState = "idle" | "loading" | "ready" | "error";

// References grouped beneath their exact occurrence for constant-time reads.
interface WordVisionOccurrenceReferences
{
	// Canonical selection resolved from an anchor.
	readonly selection: TextSelection;
	// Deterministically ordered reader placements.
	readonly references: WordVisionReference[];
}

// Creates an identity that never conflates versions or identical-looking Greek.
export function GetTextSelectionIdentity(selection: TextSelection): string
{
	const identity = `${selection.dialogue}:${selection.text_version}:${selection.start.stephanus}:${selection.start.offset}:${selection.end.stephanus}:${selection.end.offset}`;
	return identity;
}

// Owns rebuildable exact-reference results and resolved anchors per work.
export class WordVisionReferenceStore
{
	// Reverse projections, separated so changing works cannot erase another work's results.
	private readonly works = new Map<string, ReadonlyMap<string, WordVisionOccurrenceReferences>>();
	// Immutable anchor records acquired through the owning IPC gateway.
	private readonly anchors = new Map<string, ReadonlyMap<string, TextAnchorSnapshot>>();
	// Availability tracked independently from the last usable results.
	private readonly states = new Map<string, WordVisionReferenceState>();

	// Reads the availability of the requested work only.
	public GetState(workId: string): WordVisionReferenceState
	{
		const state = this.states.get(workId) ?? "idle";
		return state;
	}

	// Resolves every placement for the exact versioned occurrence.
	public Get(selection: TextSelection): readonly WordVisionReference[]
	{
		const key = GetTextSelectionIdentity(selection);
		const references = this.works.get(selection.dialogue)?.get(key)?.references ?? [];
		const result = structuredClone(references);
		return result;
	}

	// Reports whether the work's authoritative anchors have been acquired.
	public HasAnchors(workId: string): boolean
	{
		const loaded = this.anchors.has(workId);
		return loaded;
	}

	// Reads a resolved anchor without another IPC round trip.
	public GetAnchor(workId: string, anchorId: string): TextAnchorSnapshot | null
	{
		const anchor = this.anchors.get(workId)?.get(anchorId) ?? null;
		return anchor;
	}

	// Replaces only the requested work's anchor accelerator.
	public SetAnchors(workId: string, anchors: readonly TextAnchorSnapshot[]): void
	{
		const byId = new Map<string, TextAnchorSnapshot>();
		for (const anchor of anchors)
		{
			if (anchor.workId === workId)
			{
				byId.set(anchor.id, anchor);
			}
		}
		this.anchors.set(workId, byId);
	}

	// Discards accelerators after catalogue replacement without erasing usable links.
	public InvalidateAnchors(): void
	{
		this.anchors.clear();
		this.states.clear();
	}

	// Announces initial loading while retaining any previously resolved placements.
	public SetLoading(workId: string): void
	{
		this.states.set(workId, "loading");
	}

	// Marks resolution failure while retaining links already backed by exact anchors.
	public SetError(workId: string): void
	{
		this.states.set(workId, "error");
	}

	// Reconciles one Vision without rebuilding other documents' relationships.
	public ReplaceVision(workId: string, visionId: string, records: readonly WordVisionReferenceRecord[]): readonly string[]
	{
		const next: WordVisionReferenceRecord[] = [];
		for (const occurrence of this.works.get(workId)?.values() ?? [])
		{
			for (const reference of occurrence.references)
			{
				if (reference.visionId !== visionId)
				{
					next.push({ selection: occurrence.selection, reference });
				}
			}
		}
		next.push(...records);
		const changedKeys = this.Set(workId, next);
		return changedKeys;
	}

	// Rebuilds from authoritative records and identifies only changed occurrence lists.
	public Set(workId: string, records: readonly WordVisionReferenceRecord[]): readonly string[]
	{
		const before = this.works.get(workId) ?? new Map<string, WordVisionOccurrenceReferences>();
		const after = this.Group(records);
		const keys = new Set<string>([...before.keys(), ...after.keys()]);
		const changedKeys: string[] = [];
		for (const key of keys)
		{
			const previous = JSON.stringify(before.get(key)?.references ?? []);
			const current = JSON.stringify(after.get(key)?.references ?? []);
			if (previous !== current)
			{
				changedKeys.push(key);
			}
		}
		this.works.set(workId, after);
		this.states.set(workId, "ready");
		return changedKeys;
	}

	// Canonicalizes result lists so unchanged relationships produce no notifications.
	private Group(records: readonly WordVisionReferenceRecord[]): Map<string, WordVisionOccurrenceReferences>
	{
		const groups = new Map<string, WordVisionOccurrenceReferences>();
		for (const record of records)
		{
			const key = GetTextSelectionIdentity(record.selection);
			const occurrence: WordVisionOccurrenceReferences = groups.get(key) ?? { selection: record.selection, references: [] };
			const references = occurrence.references;
			const duplicate = references.some(function MatchesPlacement(candidate): boolean
			{
				const matches = candidate.visionId === record.reference.visionId && candidate.placementId === record.reference.placementId;
				return matches;
			});
			if (!duplicate)
			{
				references.push(record.reference);
				groups.set(key, occurrence);
			}
		}
		for (const occurrence of groups.values())
		{
			occurrence.references.sort(this.CompareReferences.bind(this));
		}
		return groups;
	}

	// Stabilizes presentation when multiple Visions use the same occurrence.
	private CompareReferences(first: WordVisionReference, second: WordVisionReference): number
	{
		const order = first.visionTitle.localeCompare(second.visionTitle)
			|| first.visionId.localeCompare(second.visionId)
			|| first.placementId.localeCompare(second.placementId);
		return order;
	}
}

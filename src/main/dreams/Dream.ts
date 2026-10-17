import type { DreamSnapshot } from "../../shared/dreams/DreamTypes.js";
import { TextAnnotation } from "../../shared/text/TextAnnotation.js";

// Owns one reader-authored Dream and its canonical Signal associations.
export class Dream extends TextAnnotation
{
	// Optional human-readable name of the originating work.
	private readonly dialogue: string | null;
	// Reader-authored title.
	private readonly title: string;
	// Canonical Signal identities associated with this Dream.
	private readonly signalIds: readonly string[];
	// Reader-authored reflections.
	private readonly reflection: string;
	// Reader-editable result of the model-assisted Clarity Check.
	private readonly synopticView: string;
	// Other Dreams linked by stable identifier.
	private readonly linkedDreamIds: string[];
	// Initial persistence timestamp.
	private readonly createdAt: string;
	// Most recent persistence timestamp.
	private readonly updatedAt: string;

	// Hydrates one Dream and normalizes persisted or IPC-supplied record fields.
	public constructor(snapshot: DreamSnapshot)
	{
		ValidateIdentifier(snapshot.id, "Dream identifier");
		ValidateIdentifier(snapshot.workId, "Dream work identifier");
		super({ id: snapshot.id, workId: snapshot.workId, selection: snapshot.source });
		this.dialogue = snapshot.dialogue;
		this.title = snapshot.title.trim();
		this.signalIds = this.NormalizeSignalIds(snapshot.signalIds ?? []);
		this.reflection = snapshot.reflection;
		this.synopticView = snapshot.synopticView;
		this.linkedDreamIds = this.NormalizeLinks(snapshot.linkedDreamIds);
		this.createdAt = snapshot.createdAt;
		this.updatedAt = snapshot.updatedAt;
	}

	// Returns the stable identity owned by this Dream.
	public GetId(): string
	{
		return this.id;
	}

	// Produces an immutable IPC and persistence record.
	public ToSnapshot(): DreamSnapshot
	{
		const snapshot: DreamSnapshot = {
			id: this.id,
			workId: this.workId,
			dialogue: this.dialogue,
			title: this.title,
			source: structuredClone(this.selection),
			signalIds: [...this.signalIds],
			reflection: this.reflection,
			synopticView: this.synopticView,
			linkedDreamIds: [...this.linkedDreamIds],
			createdAt: this.createdAt,
			updatedAt: this.updatedAt
		};

		return snapshot;
	}

	// Removes duplicate and invalid Signal identities from this Dream's associations.
	private NormalizeSignalIds(signalIds: readonly string[]): string[]
	{
		const normalizedIds = new Set<string>();

		for (const signalId of signalIds)
		{
			const normalizedId = signalId.trim();

			if (normalizedId.length > 0)
			{
				ValidateIdentifier(normalizedId, "Signal identifier");
				normalizedIds.add(normalizedId);
			}
		}

		return [...normalizedIds];
	}

	// Removes duplicate links and the Dream's own identity.
	private NormalizeLinks(linkedDreamIds: readonly string[]): string[]
	{
		const links = new Set<string>();

		for (const linkedDreamId of linkedDreamIds)
		{
			const normalizedId = linkedDreamId.trim();
			const isSelf = normalizedId === this.id;

			if (normalizedId.length > 0 && !isSelf)
			{
				links.add(normalizedId);
			}
		}

		const normalizedLinks = [...links];

		return normalizedLinks;
	}

	}

// Rejects identifiers that cannot safely participate in Dream ownership.
function ValidateIdentifier(value: string, label: string): void
{
	const pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
	const isValid = pattern.test(value);

	if (!isValid)
	{
		throw new Error(`${label} is invalid`);
	}
}
import type { IdeaRecord, IdeaSignalReference, SaveIdeaCommand } from "../../shared/ideas/IdeaTypes.js";

// Owns the intrinsic validity and immutable metadata of one durable Idea.
export class Idea
{
	// Identifies this Idea.
	private readonly id: string;
	// Identifies the work that owns this Idea.
	private readonly workId: string;
	// Contains the normalized reader-authored title.
	private readonly title: string;
	// Contains the reader-authored explanation.
	private readonly content: string;
	// Identifies the immutable Signal from which this Idea emerged.
	private readonly originSignal: IdeaSignalReference | null;
	// Contains the normalized distinct Signals connected after the origin.
	private readonly relatedSignals: readonly IdeaSignalReference[];
	// Records when this Idea was created.
	private readonly createdAt: string;
	// Records when this Idea was most recently updated.
	private readonly updatedAt: string;

	// Hydrates one durable Idea and enforces its intrinsic invariants.
	public constructor(record: IdeaRecord)
	{
		this.ValidateIdentifier(record.id, "Idea identifier");
		this.ValidateIdentifier(record.workId, "Idea work identifier");
		const originSignal = record.originSignal === null ? null : this.NormalizeReference(record.originSignal);
		const relatedSignals = this.NormalizeRelatedSignals(originSignal, record.relatedSignals);
		this.id = record.id;
		this.workId = record.workId;
		this.title = record.title.trim();
		this.content = record.content;
		this.originSignal = originSignal;
		this.relatedSignals = relatedSignals;
		this.createdAt = record.createdAt;
		this.updatedAt = record.updatedAt;
	}

	// Creates a new durable Idea from reader-owned draft data and main-owned metadata.
	public static Create(command: SaveIdeaCommand, ideaId: string, timestamp: string): Idea
	{
		const record: IdeaRecord = {
			id: ideaId,
			workId: command.workId,
			title: command.title,
			content: command.content,
			originSignal: command.originSignal,
			relatedSignals: command.relatedSignals,
			createdAt: timestamp,
			updatedAt: timestamp
		};
		const idea = new Idea(record);

		return idea;
	}

	// Returns the stable identity of this Idea.
	public GetId(): string
	{
		const id = this.id;

		return id;
	}

	// Returns the work identity owned by this Idea.
	public GetWorkId(): string
	{
		const workId = this.workId;

		return workId;
	}

	// Applies reader-editable fields while preserving main-owned metadata.
	public Update(command: SaveIdeaCommand, timestamp: string): Idea
	{
		if (command.workId !== this.workId)
		{
			throw new Error("Idea cannot move between works");
		}

		const submittedOrigin = command.originSignal === null ? null : this.NormalizeReference(command.originSignal);

		const record: IdeaRecord = {
			id: this.id,
			workId: this.workId,
			title: command.title,
			content: command.content,
			originSignal: submittedOrigin,
			relatedSignals: command.relatedSignals,
			createdAt: this.createdAt,
			updatedAt: timestamp
		};
		const updated = new Idea(record);

		return updated;
	}

	// Produces an immutable record for IPC and persistence.
	public ToRecord(): IdeaRecord
	{
		const record: IdeaRecord = {
			id: this.id,
			workId: this.workId,
			title: this.title,
			content: this.content,
			originSignal: structuredClone(this.originSignal),
			relatedSignals: structuredClone(this.relatedSignals),
			createdAt: this.createdAt,
			updatedAt: this.updatedAt
		};

		return record;
	}

	// Normalizes one work-owned Signal reference.
	private NormalizeReference(reference: IdeaSignalReference): IdeaSignalReference
	{
		const signalId = reference.signalId.trim();
		if (reference.rationale !== undefined && reference.rationale !== null && typeof reference.rationale !== "string")
		{
			throw new Error("Idea Signal rationale is invalid");
		}
		const rationaleText = reference.rationale?.trim() ?? "";
		const rationale = rationaleText.length > 0 ? rationaleText : null;
		this.ValidateIdentifier(signalId, "Idea Signal reference");
		const normalized: IdeaSignalReference = rationale === null
			? { signalId }
			: { signalId, rationale };

		return normalized;
	}

	// Normalizes related Signals and removes the origin and duplicate identities.
	private NormalizeRelatedSignals(
		originSignal: IdeaSignalReference | null,
		relatedSignals: readonly IdeaSignalReference[]): IdeaSignalReference[]
	{
		const normalized: IdeaSignalReference[] = [];
		const identities = new Set<string>();
		if (originSignal !== null)
		{
			const originIdentity = this.CreateReferenceIdentity(originSignal.signalId);
			identities.add(originIdentity);
		}

		for (const reference of relatedSignals)
		{
			const normalizedReference = this.NormalizeReference(reference);
			const identity = this.CreateReferenceIdentity(normalizedReference.signalId);
			const isKnown = identities.has(identity);

			if (!isKnown)
			{
				identities.add(identity);
				normalized.push(normalizedReference);
			}
		}

		return normalized;
	}

	// Creates the stable identity used to compare Signal references.
	private CreateReferenceIdentity(signalId: string): string
	{
		const identity = `signal:${signalId}`;

		return identity;
	}

	// Rejects identifiers that cannot safely participate in ownership or persistence.
	private ValidateIdentifier(value: string, label: string): void
	{
		const pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
		const isValid = pattern.test(value);

		if (!isValid)
		{
			throw new Error(`${label} is invalid`);
		}
	}
}

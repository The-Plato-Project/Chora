import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { CreateDreamCommand, DreamSnapshot, UpdateDreamCommand } from "../../shared/dreams/DreamTypes.js";
import type { CreateSignalCommand, DeleteSignalCommand, SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";
import { TextAnnotation } from "../../shared/text/TextAnnotation.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import { Signal } from "../signals/Signal.js";

// Result of an immutable child-Signal mutation on one Dream aggregate.
export interface DreamSignalChange
{
	// Next immutable Dream aggregate after the child mutation.
	readonly dream: Dream;
	// Canonical Signal created, updated, or removed by the mutation.
	readonly signal: SignalRecord;
}

// Owns one reader-authored Dream and its canonical child Signals.
export class Dream extends TextAnnotation
{
	// Optional human-readable name of the originating work.
	private readonly dialogue: string | null;
	// Reader-authored title.
	private readonly title: string;
	// Canonical Signals owned by this Dream.
	private readonly signals: readonly SignalRecord[];
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
		this.signals = this.NormalizeSignals(snapshot.signals);
		this.reflection = snapshot.reflection;
		this.synopticView = snapshot.synopticView;
		this.linkedDreamIds = this.NormalizeLinks(snapshot.linkedDreamIds);
		this.createdAt = snapshot.createdAt;
		this.updatedAt = snapshot.updatedAt;
	}

	// Creates one new Dream aggregate from reader-selected source metadata.
	public static Create(command: CreateDreamCommand, dreamId: string, timestamp: string): Dream
	{
		const snapshot: DreamSnapshot = {
			id: dreamId,
			workId: command.workId,
			dialogue: command.dialogue,
			title: "",
			source: structuredClone(command.source),
			signals: [],
			reflection: "",
			synopticView: "",
			linkedDreamIds: [],
			createdAt: timestamp,
			updatedAt: timestamp
		};
		const dream = new Dream(snapshot);

		return dream;
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
			signals: structuredClone(this.signals),
			reflection: this.reflection,
			synopticView: this.synopticView,
			linkedDreamIds: [...this.linkedDreamIds],
			createdAt: this.createdAt,
			updatedAt: this.updatedAt
		};

		return snapshot;
	}

	// Applies reader-editable Dream fields while preserving identity, origin, and child Signals.
	public Update(command: UpdateDreamCommand, timestamp: string): Dream
	{
		if (command.dreamId !== this.id)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM", "Dream identity cannot change");
		}

		const current = this.ToSnapshot();
		const updated = new Dream({
			...current,
			title: command.title,
			source: structuredClone(command.source),
			reflection: command.reflection,
			synopticView: command.synopticView,
			linkedDreamIds: [...command.linkedDreamIds],
			updatedAt: timestamp
		});

		return updated;
	}

	// Loads one complete persisted child Signal into its owning Dream.
	public LoadSignal(record: SignalRecord): DreamSignalChange
	{
		const signal = new Signal(record);
		const canonical = signal.ToRecord();
		const dream = this.WithSignal(canonical);
		const change: DreamSignalChange = { dream, signal: canonical };

		return change;
	}

	// Creates one child Signal whose main passage belongs to this Dream source.
	public CreateSignal(
		command: CreateSignalCommand,
		signalId: string,
		timestamp: string,
		document: TextDocument): DreamSignalChange
	{
		if (command.dreamId !== this.id)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM", "Signal does not belong to the requested Dream");
		}

		document.ValidateSelection(command.selection);

		if (!document.Contains(command.selection, this.selection))
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM", "A Signal must be created inside its owning Dream source");
		}

		const signal = Signal.Create(command, signalId, timestamp, document);
		const record = signal.ToRecord();
		const dream = this.WithSignal(record);
		const change: DreamSignalChange = { dream, signal: record };

		return change;
	}

	// Updates one child Signal without permitting identity or Dream ownership to change.
	public UpdateSignal(command: UpdateSignalCommand, timestamp: string, document: TextDocument): DreamSignalChange
	{
		const existing = this.RequireSignal(command.signalId, command.dreamId);
		const signal = new Signal(existing);
		const updated = signal.Update(command, timestamp, document);
		const record = updated.ToRecord();
		const records = this.signals.map(function ReplaceSignal(candidate): SignalRecord
		{
			return candidate.id === record.id ? record : candidate;
		});
		const dream = this.WithSignals(records);
		const change: DreamSignalChange = { dream, signal: record };

		return change;
	}

	// Removes one child Signal and returns both the next aggregate and deleted record.
	public DeleteSignal(command: DeleteSignalCommand): DreamSignalChange
	{
		const signal = this.RequireSignal(command.signalId, command.dreamId);
		const records = this.signals.filter(function KeepSignal(candidate): boolean
		{
			return candidate.id !== signal.id;
		});
		const dream = this.WithSignals(records);
		const change: DreamSignalChange = { dream, signal };

		return change;
	}

	// Returns immutable records for every Signal owned by this Dream.
	public GetSignals(): readonly SignalRecord[]
	{
		const signals = structuredClone(this.signals);

		return signals;
	}

	// Adds one unique canonical child record to this immutable aggregate.
	private WithSignal(signal: SignalRecord): Dream
	{
		const exists = this.signals.some(function MatchesSignal(candidate): boolean
		{
			return candidate.id === signal.id;
		});

		if (exists)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM", `Dream contains duplicate Signal: ${signal.id}`);
		}

		const dream = this.WithSignals([...this.signals, signal]);

		return dream;
	}

	// Rebuilds this immutable aggregate with one canonical child collection.
	private WithSignals(signals: readonly SignalRecord[]): Dream
	{
		const snapshot = this.ToSnapshot();
		const dream = new Dream({
			...snapshot,
			signals: structuredClone(signals)
		});

		return dream;
	}

	// Returns one child Signal after validating requested aggregate ownership.
	private RequireSignal(signalId: string, dreamId: string): SignalRecord
	{
		if (dreamId !== this.id)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM", "Signal does not belong to the requested Dream");
		}

		const signal = this.signals.find(function MatchesSignal(candidate): boolean
		{
			return candidate.id === signalId;
		});

		if (signal === undefined)
		{
			throw ApplicationError.Expected("validation", "INVALID_DREAM", `Signal does not belong to the requested Dream: ${signalId}`);
		}

		return structuredClone(signal);
	}

	// Validates unique Signal identities and immutable ownership within this Dream.
	private NormalizeSignals(signals: readonly SignalRecord[]): SignalRecord[]
	{
		const normalizedSignals: SignalRecord[] = [];
		const ids = new Set<string>();

		for (const signal of signals)
		{
			ValidateIdentifier(signal.id, "Signal identifier");
			const isOwned = signal.dreamId === this.id;
			const isSameWork = signal.workId === this.workId;

			if (!isOwned || !isSameWork)
			{
				throw ApplicationError.Expected("validation", "INVALID_DREAM", "Signal does not belong to its containing Dream");
			}
			if (ids.has(signal.id))
			{
				throw ApplicationError.Expected("validation", "INVALID_DREAM", `Dream contains duplicate Signal: ${signal.id}`);
			}

			ids.add(signal.id);
			normalizedSignals.push(structuredClone(signal));
		}

		return normalizedSignals;
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
		throw ApplicationError.Expected("validation", "INVALID_DREAM", `${label} is invalid`);
	}
}
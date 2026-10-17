import type { SaveSignalCommand, SignalRecord } from "../../shared/signals/SignalTypes.js";
import { TextAnnotation } from "../../shared/text/TextAnnotation.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import { IsValidSignalSelection } from "../../shared/signals/SignalSelection.js";

// Owns the intrinsic data and validity of one work-owned Signal.
export class Signal extends TextAnnotation
{
	// Contains the normalized immutable Signal snapshot.
	private readonly record: SignalRecord;

	// Hydrates one normalized Signal record.
	public constructor(record: SignalRecord, document: TextDocument)
	{
		super({ id: record.id, workId: record.workId, selection: record.selection });
		this.ValidateIdentifier(record.id, "Signal identifier");
		this.ValidateIdentifier(record.workId, "Signal work identifier");
		document.ValidateSelection(record.selection);
		const citation = document.ResolveCitation(record.selection.start);

		this.record = {
			...structuredClone(record),
			selection: structuredClone(this.selection),
			sourceRef: citation?.value ?? record.selection.start.segmentKey,
			text: document.ReconstructText(record.selection)
		};
	}

	// Creates a new Signal from reader-authored data and authoritative metadata.
	public static Create(command: SaveSignalCommand, signalId: string, timestamp: string, document: TextDocument): Signal
	{
		const selectedText = document.ReconstructText(command.selection);
		const isValid = IsValidSignalSelection(command.selection)
			&& selectedText.trim().length > 0;

		if (!isValid)
		{
			throw new Error("Signal selections must not be empty");
		}

		const record: SignalRecord = {
			id: signalId,
			workId: command.workId,
			sourceRef: document.ResolveCitation(command.selection.start)?.value ?? command.selection.start.segmentKey,
			selection: command.selection,
			text: selectedText,
			description: command.description,
			createdAt: timestamp,
			updatedAt: timestamp
		};
		const signal = new Signal(record, document);

		return signal;
	}

	// Applies reader-editable fields while preserving identity and creation metadata.
	public Update(command: SaveSignalCommand, timestamp: string, document: TextDocument): Signal
	{
		if (command.workId !== this.record.workId)
		{
			throw new Error("Signal cannot move between works");
		}

		const record: SignalRecord = {
			...structuredClone(this.record),
			selection: command.selection,
			text: document.ReconstructText(command.selection),
			sourceRef: document.ResolveCitation(command.selection.start)?.value ?? command.selection.start.segmentKey,
			description: command.description,
			updatedAt: timestamp
		};
		const signal = new Signal(record, document);

		return signal;
	}

	// Returns an immutable Signal record for persistence and IPC.
	public ToRecord(): SignalRecord
	{
		const record = structuredClone(this.record);

		return record;
	}

	// Rejects identifiers that cannot safely participate in persistence.
	private ValidateIdentifier(value: string, label: string): void
	{
		const pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

		if (!pattern.test(value))
		{
			throw new Error(`${label} is invalid`);
		}
	}
}

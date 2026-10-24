import type { SaveSignalCommand, SignalRecord } from "../../shared/signals/SignalTypes.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import { IsValidSignalSelection } from "../../shared/signals/SignalSelection.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";

// Owns the intrinsic data and validity of one work-owned Signal.
export class Signal
{
	// Contains the normalized immutable Signal snapshot.
	private readonly record: SignalRecord;

	// Hydrates one normalized Signal record.
	public constructor(record: SignalRecord, document: TextDocument)
	{
		this.ValidateIdentifier(record.id, "Signal identifier");
		this.ValidateIdentifier(record.workId, "Signal work identifier");
		const selections = Signal.NormalizeSelections(record.selections, record.workId, document);
		const firstSelection = selections[0];

		if (firstSelection === undefined)
		{
			throw new Error("Signal selections must not be empty");
		}

		const citation = document.ResolveCitation(firstSelection.start);
		const firstText = document.ReconstructText(firstSelection);
		const title = this.NormalizeTitle(record.title, firstText);

		this.record = {
			...structuredClone(record),
			title,
			selections,
			sourceRef: citation?.value ?? firstSelection.start.segmentKey,
			text: Signal.ReconstructText(selections, document)
		};
	}

	// Creates a new Signal from reader-authored data and authoritative metadata.
	public static Create(command: SaveSignalCommand, signalId: string, timestamp: string, document: TextDocument): Signal
	{
		const selections = Signal.NormalizeCommandSelections(command, document);
		const firstSelection = selections[0] as TextSelection;
		const title = command.title ?? document.ReconstructText(firstSelection).trim();

		const record: SignalRecord = {
			id: signalId,
			workId: command.workId,
			sourceRef: document.ResolveCitation(firstSelection.start)?.value ?? firstSelection.start.segmentKey,
			title,
			selections,
			text: "",
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

		const selections = Signal.NormalizeCommandSelections(command, document);
		const firstSelection = selections[0] as TextSelection;
		const record: SignalRecord = {
			...structuredClone(this.record),
			title: command.title ?? this.record.title ?? document.ReconstructText(firstSelection).trim(),
			selections,
			text: Signal.ReconstructText(selections, document),
			sourceRef: document.ResolveCitation(firstSelection.start)?.value ?? firstSelection.start.segmentKey,
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

	// Validates and normalizes reader-authored selections before creating or updating a Signal.
	private static NormalizeCommandSelections(command: SaveSignalCommand, document: TextDocument): readonly TextSelection[]
	{
		const selections = Signal.NormalizeSelections(command.selections, command.workId, document);

		return selections;
	}

	// Orders components and merges duplicate, overlapping, or directly touching ranges.
	private static NormalizeSelections(
		candidates: readonly TextSelection[],
		workId: string,
		document: TextDocument): readonly TextSelection[]
	{
		if (candidates.length === 0)
		{
			throw new Error("Signal selections must not be empty");
		}

		const ordered = candidates.map(function CloneSelection(selection): TextSelection
		{
			return structuredClone(selection);
		}).sort(function CompareSelections(first, second): number
		{
			return document.CompareSelections(first, second);
		});
		const selections: TextSelection[] = [];

		for (const selection of ordered)
		{
			document.ValidateSelection(selection);
			const selectedText = document.ReconstructText(selection);
			const isValid = selection.documentId === workId
				&& IsValidSignalSelection(selection)
				&& selectedText.trim().length > 0;

			if (!isValid)
			{
				throw new Error("Signal selections must not be empty or belong to another work");
			}

			const previous = selections[selections.length - 1];

			if (previous !== undefined && Signal.ShouldMerge(previous, selection, document))
			{
				selections[selections.length - 1] = document.MergeSelections(previous, selection);
			}
			else
			{
				selections.push(selection);
			}
		}

		return selections;
	}

	// Determines whether two ordered ranges overlap or meet at an exact segment boundary.
	private static ShouldMerge(first: TextSelection, second: TextSelection, document: TextDocument): boolean
	{
		let shouldMerge = document.ComparePositions(second.start, first.end) <= 0;

		if (!shouldMerge)
		{
			const firstSegmentIndex = document.segments.findIndex((segment) => segment.key === first.end.segmentKey);
			const secondSegmentIndex = document.segments.findIndex((segment) => segment.key === second.start.segmentKey);
			const firstSegment = document.segments[firstSegmentIndex];
			shouldMerge = firstSegment !== undefined
				&& first.end.offset === firstSegment.text.length
				&& second.start.offset === 0
				&& secondSegmentIndex === firstSegmentIndex + 1;
		}

		return shouldMerge;
	}

	// Reconstructs each exact component without representing the omitted gaps as selected text.
	private static ReconstructText(selections: readonly TextSelection[], document: TextDocument): string
	{
		const text = selections.map(function Reconstruct(selection): string
		{
			return document.ReconstructText(selection);
		}).join(" … ");

		return text;
	}

	// Uses the first exact passage until the reader supplies a non-empty title.
	private NormalizeTitle(title: string | undefined, firstText: string): string
	{
		const normalized = title?.trim() ?? "";
		const value = normalized.length > 0 ? normalized : firstText.trim();

		if (value.length === 0)
		{
			throw new Error("Signal title must not be empty");
		}

		return value;
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

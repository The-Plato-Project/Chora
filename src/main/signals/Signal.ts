import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { CreateSignalCommand, SignalRecord, UpdateSignalCommand } from "../../shared/signals/SignalTypes.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import { AreTextSelectionsEqual, IsValidSignalSelection } from "../../shared/signals/SignalSelection.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";

// Owns the intrinsic data and validity of one Dream-owned Signal.
export class Signal
{
	// Contains the normalized immutable Signal snapshot.
	private readonly record: SignalRecord;

	// Hydrates one complete persisted Signal without reopening its immutable source text.
	public constructor(record: SignalRecord)
	{
		this.ValidateIdentifier(record.id, "Signal identifier");
		this.ValidateIdentifier(record.dreamId, "Signal Dream identifier");
		this.ValidateIdentifier(record.workId, "Signal work identifier");
		const selections = Signal.CloneStoredSelections(record.selections, record.workId);

		if (record.sourceRef.trim().length === 0)
		{
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal source reference must not be empty");
		}
		if (record.text.trim().length === 0)
		{
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal passage text must not be empty");
		}
		const title = this.NormalizeTitle(record.title, record.text);

		this.record = {
			...structuredClone(record),
			title,
			sourceRef: record.sourceRef.trim(),
			selections
		};
	}

	// Creates a new Signal from reader-authored data and authoritative metadata.
	public static Create(command: CreateSignalCommand, signalId: string, timestamp: string, document: TextDocument): Signal
	{
		const selections = Signal.NormalizeSelections([command.selection], command.selection.dialogue, document);
		const firstSelection = selections[0] as TextSelection;
		const title = document.ReconstructText(firstSelection).trim();

		const record: SignalRecord = {
			id: signalId,
			dreamId: command.dreamId,
			workId: command.selection.dialogue,
			sourceRef: document.ResolveCitation(firstSelection.start)?.value ?? firstSelection.start.stephanus,
			title,
			selections,
			text: Signal.ReconstructText(selections, document),
			description: "",
			createdAt: timestamp,
			updatedAt: timestamp
		};
		const signal = new Signal(record);

		return signal;
	}

	// Applies reader-editable fields while preserving identity and creation metadata.
	public Update(command: UpdateSignalCommand, timestamp: string, document: TextDocument): Signal
	{
		if (command.dreamId !== this.record.dreamId)
		{
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal cannot move between Dreams");
		}

		const selections = Signal.NormalizeUpdatedSelections(command, this.record.workId, this.record.selections[0], document);
		const firstSelection = selections[0] as TextSelection;
		const record: SignalRecord = {
			...structuredClone(this.record),
			title: command.title ?? this.record.title ?? document.ReconstructText(firstSelection).trim(),
			selections,
			text: Signal.ReconstructText(selections, document),
			sourceRef: document.ResolveCitation(firstSelection.start)?.value ?? firstSelection.start.stephanus,
			description: command.description,
			updatedAt: timestamp
		};
		const signal = new Signal(record);

		return signal;
	}

	// Returns an immutable Signal record for persistence and IPC.
	public ToRecord(): SignalRecord
	{
		const record = structuredClone(this.record);

		return record;
	}

	// Retains the existing main passage when it remains present in an update.
	private static NormalizeUpdatedSelections(
		command: UpdateSignalCommand,
		workId: string,
		existingAnchor: TextSelection | undefined,
		document: TextDocument): readonly TextSelection[]
	{
		let candidates = command.selections;

		if (existingAnchor !== undefined)
		{
			const retainsAnchor = command.selections.some(function MatchesAnchor(selection): boolean
			{
				return AreTextSelectionsEqual(selection, existingAnchor);
			});

			if (retainsAnchor)
			{
				const additions = command.selections.filter(function ExcludesAnchor(selection): boolean
				{
					return !AreTextSelectionsEqual(selection, existingAnchor);
				});
				candidates = [existingAnchor, ...additions];
			}
		}

		const selections = Signal.NormalizeSelections(candidates, workId, document);

		return selections;
	}

	// Preserves the first-added main passage and orders later components behind it.
	private static NormalizeSelections(
		candidates: readonly TextSelection[],
		workId: string,
		document: TextDocument): readonly TextSelection[]
	{
		if (candidates.length === 0)
		{
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal selections must not be empty");
		}

		const validated = candidates.map(function CloneSelection(selection): TextSelection
		{
			return structuredClone(selection);
		});

		for (const selection of validated)
		{
			document.ValidateSelection(selection);
			const selectedText = document.ReconstructText(selection);
			const isValid = selection.dialogue === workId
				&& IsValidSignalSelection(selection)
				&& selectedText.trim().length > 0;

			if (!isValid)
			{
				throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal selections must not be empty or belong to another work");
			}
		}

		let anchor = validated[0] as TextSelection;
		const additions = validated.slice(1).filter(function ExcludesDuplicateAnchor(selection): boolean
		{
			return !AreTextSelectionsEqual(selection, anchor);
		}).sort(function CompareSelections(first, second): number
		{
			return document.CompareSelections(first, second);
		});
		const selections: TextSelection[] = [anchor];

		for (const selection of additions)
		{
			const previousAddition = selections.length > 1 ? selections[selections.length - 1] : undefined;
			const startsAtOrAfterAnchor = document.ComparePositions(selection.start, anchor.start) >= 0;

			if (startsAtOrAfterAnchor && Signal.ShouldMerge(anchor, selection, document))
			{
				anchor = document.MergeSelections(anchor, selection);
				selections[0] = anchor;
			}
			else if (previousAddition !== undefined && Signal.ShouldMerge(previousAddition, selection, document))
			{
				selections[selections.length - 1] = document.MergeSelections(previousAddition, selection);
			}
			else
			{
				selections.push(selection);
			}
		}

		return selections;
	}

	// Validates the self-contained persisted selection shape without reopening the source corpus.
	private static CloneStoredSelections(candidates: readonly TextSelection[], workId: string): readonly TextSelection[]
	{
		if (candidates.length === 0)
		{
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal selections must not be empty");
		}

		const selections = candidates.map(function CloneSelection(selection): TextSelection
		{
			return structuredClone(selection);
		});

		for (const selection of selections)
		{
			const isValid = selection.dialogue === workId
				&& IsValidSignalSelection(selection)
				&& selection.start.offset >= 0
				&& selection.end.offset >= 0;

			if (!isValid)
			{
				throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Stored Signal selections are invalid or belong to another work");
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
			const firstSegmentIndex = document.segments.findIndex((segment) => segment.key === first.end.stephanus);
			const secondSegmentIndex = document.segments.findIndex((segment) => segment.key === second.start.stephanus);
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
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", "Signal title must not be empty");
		}

		return value;
	}

	// Rejects identifiers that cannot safely participate in persistence.
	private ValidateIdentifier(value: string, label: string): void
	{
		const pattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

		if (!pattern.test(value))
		{
			throw ApplicationError.Expected("validation", "INVALID_SIGNAL", `${label} is invalid`);
		}
	}
}

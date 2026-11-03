import type { TextPosition, TextSelection } from "./TextSelection.js";

// Serialized form of one source citation at an IPC or JSON boundary.
export interface CitationSnapshot
{
	readonly system: string;
	readonly value: string;
}

// Identifies a passage using the reference system supplied by an edition.
export class Citation
{
	public readonly system: string;
	public readonly value: string;

	public constructor(system: string, value: string)
	{
		this.system = system;
		this.value = value;
	}

	// Produces the explicit serialized representation of this citation.
	public ToSnapshot(): CitationSnapshot
	{
		const snapshot: CitationSnapshot = {
			system: this.system,
			value: this.value
		};

		return snapshot;
	}
}

// Serialized form of one structural document division.
export interface DocumentDivisionSnapshot
{
	readonly type: string;
	readonly label: string;
}

// Identifies a semantic range within one canonical text segment.
export interface TextAnnotationSnapshot
{
	readonly kind: "quotation" | "citation";
	readonly start: number;
	readonly end: number;
}

// Identifies a named structural division such as a book or chapter.
export class DocumentDivision
{
	public readonly type: string;
	public readonly label: string;

	public constructor(type: string, label: string)
	{
		this.type = type;
		this.label = label;
	}

	// Produces the explicit serialized representation of this division.
	public ToSnapshot(): DocumentDivisionSnapshot
	{
		const snapshot: DocumentDivisionSnapshot = {
			type: this.type,
			label: this.label
		};

		return snapshot;
	}
}

// Serialized form of one canonical stored text chunk.
export interface TextSegmentSnapshot
{
	readonly key: string;
	readonly citation: CitationSnapshot | null;
	readonly division?: DocumentDivisionSnapshot | null;
	readonly text: string;
	readonly annotations?: readonly TextAnnotationSnapshot[];
}

// Stores one ordered canonical chunk of a TextDocument.
export class TextSegment
{
	public readonly key: string;
	public readonly citation: Citation | null;
	public readonly division: DocumentDivision | null;
	public readonly text: string;
	public readonly annotations?: readonly TextAnnotationSnapshot[];

	public constructor(snapshot: TextSegmentSnapshot)
	{
		this.key = snapshot.key;
		this.citation = DecodeCitation(snapshot);
		this.division = DecodeDivision(snapshot);
		this.text = snapshot.text;
		const annotations = DecodeAnnotations(snapshot);
		if (annotations.length > 0)
		{
			this.annotations = annotations;
		}
	}

	// Produces the explicit serialized representation of this segment.
	public ToSnapshot(): TextSegmentSnapshot
	{
		const snapshot: TextSegmentSnapshot = {
			key: this.key,
			citation: this.citation?.ToSnapshot() ?? null,
			division: this.division?.ToSnapshot() ?? null,
			text: this.text,
			...(this.annotations !== undefined ? { annotations: structuredClone(this.annotations) } : {})
		};

		return snapshot;
	}

}

// Decodes and validates semantic ranges against their canonical segment text.
function DecodeAnnotations(snapshot: TextSegmentSnapshot): readonly TextAnnotationSnapshot[]
{
	const annotations = snapshot.annotations ?? [];
	const decoded: TextAnnotationSnapshot[] = [];

	for (const annotation of annotations)
	{
		const validKind = annotation.kind === "quotation" || annotation.kind === "citation";
		const validRange = Number.isInteger(annotation.start)
			&& Number.isInteger(annotation.end)
			&& annotation.start >= 0
			&& annotation.start < annotation.end
			&& annotation.end <= snapshot.text.length;

		if (!validKind || !validRange)
		{
			throw new Error(`Invalid text annotation in segment ${snapshot.key}.`);
		}

		decoded.push(structuredClone(annotation));
	}

	decoded.sort(function CompareAnnotations(left, right): number
	{
		return left.start - right.start;
	});

	return decoded;
}

// Describes the edition metadata attached to a document.
export interface TextEdition
{
	readonly editor: string | null;
	readonly title: string | null;
	readonly volume: string | null;
	readonly publisher: string | null;
	readonly publicationPlace: string | null;
	readonly publicationDate: string | null;
}

// Identifies a document supplied by PlatoSI.
export type LibrarySourceKind = "platosi";

// Describes the provenance of a serialized document.
export interface TextProvenance
{
	readonly sourceKind?: LibrarySourceKind;
	readonly repository: string;
	readonly commit: string;
	readonly sourceFile: string;
	readonly license: string;
}

// Serialized form of a TextDocument at a repository or IPC boundary.
export interface TextDocumentSnapshot
{
	readonly id: string;
	readonly textVersion: string;
	readonly urn: string | null;
	readonly title: string;
	readonly titleGreek: string | null;
	readonly author: string;
	readonly language: string;
	readonly edition: TextEdition;
	readonly provenance: TextProvenance;
	readonly segments: readonly TextSegmentSnapshot[];
}

// Canonical work object that owns ordered segments and all exact-selection behavior.
export class TextDocument
{
	public readonly id: string;
	public readonly textVersion: string;
	public readonly urn: string | null;
	public readonly title: string;
	public readonly titleGreek: string | null;
	public readonly author: string;
	public readonly language: string;
	public readonly edition: TextEdition;
	public readonly provenance: TextProvenance;
	public readonly segments: readonly TextSegment[];

	public constructor(snapshot: TextDocumentSnapshot)
	{
		this.id = snapshot.id;
		this.textVersion = snapshot.textVersion;
		this.urn = snapshot.urn;
		this.title = snapshot.title;
		this.titleGreek = snapshot.titleGreek;
		this.author = snapshot.author;
		this.language = snapshot.language;
		this.edition = structuredClone(snapshot.edition);
		this.provenance = structuredClone(snapshot.provenance);
		this.segments = snapshot.segments.map(function CreateSegment(segment): TextSegment
		{
			return new TextSegment(segment);
		});
	}

	// Hydrates serialized document data.
	public static FromSnapshot(value: unknown): TextDocument
	{
		const snapshot = value as TextDocumentSnapshot;
		const document = new TextDocument(snapshot);

		return document;
	}

	// Creates and validates one exact selection owned by this document.
	public CreateSelection(start: TextPosition, end: TextPosition): TextSelection
	{
		const selection: TextSelection = {
			dialogue: this.id,
			text_version: this.textVersion,
			start: { ...start },
			end: { ...end }
		};
		this.ValidateSelection(selection);

		return selection;
	}

	// Validates document ownership, positions, offsets, and boundary ordering.
	public ValidateSelection(selection: TextSelection): void
	{
		if (selection.dialogue !== this.id || selection.text_version !== this.textVersion)
		{
			throw new Error("Selection document does not match the active document.");
		}

		const startIndex = this.GetSegmentIndex(selection.start.stephanus);
		const endIndex = this.GetSegmentIndex(selection.end.stephanus);
		const startSegment = this.segments[startIndex];
		const endSegment = this.segments[endIndex];

		if (startSegment === undefined || endSegment === undefined || endIndex < startIndex)
		{
			throw new Error("Invalid selection segment ordering.");
		}

		this.ValidateOffset(startSegment, selection.start.offset);
		this.ValidateOffset(endSegment, selection.end.offset);

		if (startIndex === endIndex && selection.end.offset < selection.start.offset)
		{
			throw new Error("Invalid selection offset ordering.");
		}
	}

	// Reconstructs the canonical selected text from ordered segment contents.
	public ReconstructText(selection: TextSelection): string
	{
		this.ValidateSelection(selection);
		const startIndex = this.GetSegmentIndex(selection.start.stephanus);
		const endIndex = this.GetSegmentIndex(selection.end.stephanus);
		const pieces: string[] = [];

		for (let index = startIndex; index <= endIndex; index += 1)
		{
			const segment = this.segments[index];

			if (segment === undefined)
			{
				throw new Error("Invalid selection segment ordering.");
			}

			let text = segment.text;

			if (index === startIndex)
			{
				text = text.slice(selection.start.offset);
			}

			if (index === endIndex)
			{
				const endOffset = index === startIndex
					? selection.end.offset - selection.start.offset
					: selection.end.offset;
				text = text.slice(0, endOffset);
			}

			pieces.push(text);
		}

		const reconstructed = pieces.join("\n");

		return reconstructed;
	}

	// Narrows a same-segment browser selection to its one Greek word, ignoring surrounding selection punctuation or spacing.
	public GetSingleGreekWordSelection(selection: TextSelection): TextSelection | null
	{
		this.ValidateSelection(selection);
		if (selection.start.stephanus !== selection.end.stephanus) return null;

		const selectedText = this.ReconstructText(selection);
		const matches = [...selectedText.matchAll(/(?:(?=\p{Script=Greek})\p{L}|\p{M})+/gu)];
		if (matches.length !== 1) return null;

		const match = matches[0];
		const word = match?.[0] ?? "";
		const startIndex = match?.index;
		if (word.length === 0 || startIndex === undefined) return null;

		const before = selectedText.slice(0, startIndex);
		const after = selectedText.slice(startIndex + word.length);
		const isBoundaryText = (value: string): boolean => /^[\s\p{P}\p{S}]*$/u.test(value);
		if (!isBoundaryText(before) || !isBoundaryText(after)) return null;

		const wordStart = selection.start.offset + startIndex;
		const wordSelection = this.CreateSelection(
			{ stephanus: selection.start.stephanus, offset: wordStart },
			{ stephanus: selection.start.stephanus, offset: wordStart + word.length }
		);

		return wordSelection;
	}

	// Determines whether the first selection is completely contained by the second.
	public Contains(selection: TextSelection, container: TextSelection): boolean
	{
		let contains = false;

		if (selection.dialogue === this.id && container.dialogue === this.id
			&& selection.text_version === this.textVersion && container.text_version === this.textVersion)
		{
			this.ValidateSelection(selection);
			this.ValidateSelection(container);
			const startsInside = this.ComparePositions(selection.start, container.start) >= 0;
			const endsInside = this.ComparePositions(selection.end, container.end) <= 0;
			contains = startsInside && endsInside;
		}

		return contains;
	}

	// Compares selections by their starting positions.
	public CompareSelections(first: TextSelection, second: TextSelection): number
	{
		this.ValidateSelection(first);
		this.ValidateSelection(second);
		const comparison = this.ComparePositions(first.start, second.start);

		return comparison;
	}

	// Creates the smallest exact selection containing both supplied selections.
	public MergeSelections(first: TextSelection, second: TextSelection): TextSelection
	{
		this.ValidateSelection(first);
		this.ValidateSelection(second);
		const start = this.ComparePositions(first.start, second.start) <= 0 ? first.start : second.start;
		const end = this.ComparePositions(first.end, second.end) >= 0 ? first.end : second.end;
		const merged = this.CreateSelection(start, end);

		return merged;
	}

	// Determines whether two selections meet at exactly one boundary without overlapping.
	public AreSelectionsAdjacent(first: TextSelection, second: TextSelection): boolean
	{
		this.ValidateSelection(first);
		this.ValidateSelection(second);
		const firstBeforeSecond = this.DoesEndMeetStart(first.end, second.start);
		const secondBeforeFirst = this.DoesEndMeetStart(second.end, first.start);
		const adjacent = firstBeforeSecond || secondBeforeFirst;

		return adjacent;
	}

	// Determines whether one ending position meets a following start within or across segments.
	private DoesEndMeetStart(end: TextPosition, start: TextPosition): boolean
	{
		const samePosition = this.ComparePositions(end, start) === 0;
		const endSegmentIndex = this.GetSegmentIndex(end.stephanus);
		const startSegmentIndex = this.GetSegmentIndex(start.stephanus);
		const endSegment = this.segments[endSegmentIndex];
		const crossesSegmentBoundary = endSegment !== undefined
			&& end.offset === endSegment.text.length
			&& start.offset === 0
			&& startSegmentIndex === endSegmentIndex + 1;
		const meets = samePosition || crossesSegmentBoundary;

		return meets;
	}

	// Resolves the citation at one exact position.
	public ResolveCitation(position: TextPosition): Citation | null
	{
		const segment = this.GetSegment(position.stephanus);
		this.ValidateOffset(segment, position.offset);

		return segment.citation;
	}

	// Resolves the structural division at one exact position.
	public ResolveDivision(position: TextPosition): DocumentDivision | null
	{
		const segment = this.GetSegment(position.stephanus);
		this.ValidateOffset(segment, position.offset);

		return segment.division;
	}

	// Returns a segment by stable key.
	public GetSegment(segmentKey: string): TextSegment
	{
		const index = this.GetSegmentIndex(segmentKey);
		const segment = this.segments[index];

		if (segment === undefined)
		{
			throw new Error(`Invalid segment key: ${segmentKey}`);
		}

		return segment;
	}

	// Produces the explicit serialized representation of this document.
	public ToSnapshot(): TextDocumentSnapshot
	{
		const segments = this.segments.map(function SerializeSegment(segment): TextSegmentSnapshot
		{
			return segment.ToSnapshot();
		});
		const snapshot: TextDocumentSnapshot = {
			id: this.id,
			textVersion: this.textVersion,
			urn: this.urn,
			title: this.title,
			titleGreek: this.titleGreek,
			author: this.author,
			language: this.language,
			edition: structuredClone(this.edition),
			provenance: structuredClone(this.provenance),
			segments
		};

		return snapshot;
	}

	// Compares two exact positions in this document.
	public ComparePositions(first: TextPosition, second: TextPosition): number
	{
		const firstIndex = this.GetSegmentIndex(first.stephanus);
		const secondIndex = this.GetSegmentIndex(second.stephanus);
		let comparison = firstIndex - secondIndex;

		if (comparison === 0)
		{
			comparison = first.offset - second.offset;
		}

		return comparison;
	}

	// Finds one segment index or rejects a stale key.
	private GetSegmentIndex(segmentKey: string): number
	{
		const index = this.segments.findIndex(function HasKey(segment): boolean
		{
			return segment.key === segmentKey;
		});

		if (index < 0)
		{
			throw new Error(`Invalid segment key: ${segmentKey}`);
		}

		return index;
	}

	// Rejects positions outside their canonical segment text.
	private ValidateOffset(segment: TextSegment, offset: number): void
	{
		const isValid = Number.isInteger(offset)
			&& offset >= 0
			&& offset <= segment.text.length;

		if (!isValid)
		{
			throw new Error(`Invalid selection offset for segment ${segment.key}: ${offset}`);
		}
	}
}

// Decodes current citation fields.
function DecodeCitation(snapshot: TextSegmentSnapshot): Citation | null
{
	const citation = snapshot.citation;
	let decoded: Citation | null = null;

	if (citation !== null)
	{
		decoded = new Citation(citation.system, citation.value);
	}
	return decoded;
}

// Decodes current division fields.
function DecodeDivision(snapshot: TextSegmentSnapshot): DocumentDivision | null
{
	const division = snapshot.division;
	let decoded: DocumentDivision | null = null;

	if (division !== null && division !== undefined)
	{
		decoded = new DocumentDivision(division.type, division.label);
	}

	return decoded;
}

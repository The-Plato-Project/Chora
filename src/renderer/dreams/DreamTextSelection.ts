import type { TextSelection } from "../../shared/text/TextSelection.js";
import { TextDocument } from "../../shared/library/LibraryTypes.js";

// One segment's contribution to a Dream's flattened source-passage text, with its offset range within that text.
interface SourcePiece
{
	// Key of the document segment this piece was taken from.
	segmentKey: string;
	// Offset within the segment where this piece begins.
	segmentOffset: number;
	// Start offset of this piece within the flattened source-passage text.
	start: number;
	// End offset of this piece within the flattened source-passage text.
	end: number;
}

// Finds the index of the segment with the given key, or -1 when it is not present.
function FindSegmentIndex(work: TextDocument, segmentKey: string): number
{
	let foundIndex = -1;

	for (let index = 0; index < work.segments.length; index += 1)
	{
		if (work.segments[index]?.key === segmentKey)
		{
			foundIndex = index;
			break;
		}
	}

	return foundIndex;
}

// Flattens a Dream's source passage into offset-addressable pieces, one per covered segment.
function BuildPieces(work: TextDocument, source: TextSelection): SourcePiece[]
{
	const startIndex = FindSegmentIndex(work, source.start.segmentKey);
	const endIndex = FindSegmentIndex(work, source.end.segmentKey);
	const pieces: SourcePiece[] = [];
	let position = 0;

	if (startIndex < 0 || endIndex < startIndex) throw new Error("Dream source segments are invalid.");

	for (let index = startIndex; index <= endIndex; index += 1)
	{
		const segment = work.segments[index];

		if (segment === undefined) throw new Error("Dream source segment is missing.");

		const segmentOffset = index === startIndex ? source.start.offset : 0;
		const segmentEnd = index === endIndex ? source.end.offset : segment.text.length;
		const length = segmentEnd - segmentOffset;
		pieces.push({ segmentKey: segment.key, segmentOffset, start: position, end: position + length });
		position += length;
		if (index < endIndex) position += 1;
	}

	return pieces;
}

// Resolves a flattened source-passage offset back to its owning segment and in-segment offset.
function GetPoint(pieces: SourcePiece[], offset: number): TextSelection["start"] | null
{
	let point: TextSelection["start"] | null = null;

	for (const piece of pieces)
	{
		if (offset >= piece.start && offset <= piece.end)
		{
			point = { segmentKey: piece.segmentKey, offset: piece.segmentOffset + offset - piece.start };
			break;
		}
	}

	return point;
}

// Converts a raw offset-range selection within a Dream's source passage into a document TextSelection.
export function CreateDreamTextSelection(work: TextDocument, source: TextSelection, startOffset: number, endOffset: number): TextSelection | null
{
	work = TextDocument.FromSnapshot(work);
	const pieces = BuildPieces(work, source);
	const start = GetPoint(pieces, startOffset);
	const end = GetPoint(pieces, endOffset);
	let selection: TextSelection | null = null;

	if (start !== null && end !== null && startOffset < endOffset)
	{
		selection = work.CreateSelection(start, end);
	}

	return selection;
}

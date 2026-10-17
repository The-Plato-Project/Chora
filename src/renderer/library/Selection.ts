import type { TextSelection } from "../../shared/text/TextSelection.js";
import { TextDocument } from "../../shared/library/LibraryTypes.js";

// Returns the nearest ancestor segment element of a selection endpoint node, or null when outside a segment.
function GetSegmentElement(node: Node | null): HTMLElement | null
{
	const element = node instanceof Element ? node : node?.parentElement ?? null;
	const segmentElement = element?.closest<HTMLElement>("[data-segment-key]") ?? null;

	return segmentElement;
}

// Returns the segment's text element when it contains the given selection endpoint node.
function GetSegmentTextElement(segment: HTMLElement, node: Node): HTMLElement | null
{
	const textElement = segment.querySelector<HTMLElement>(".segment-text");
	let result: HTMLElement | null = null;

	if (textElement !== null && textElement.contains(node)) result = textElement;

	return result;
}

interface ResolvedBoundary
{
	readonly segment: HTMLElement;
	readonly text: HTMLElement;
	readonly container: Node;
	readonly offset: number;
}

function ResolveBoundary(node: Node, offset: number, edge: "start" | "end"): ResolvedBoundary | null
{
	const segment = GetSegmentElement(node);
	const directText = segment === null ? null : GetSegmentTextElement(segment, node);
	if (segment !== null && directText !== null) return { segment, text: directText, container: node, offset };
	if (!(node instanceof Element)) return null;
	const adjacentIndex = edge === "end" ? offset - 1 : offset;
	const adjacent = node.childNodes.item(adjacentIndex);
	if (!(adjacent instanceof Element)) return null;
	const text = adjacent.matches(".segment-text")
		? adjacent as HTMLElement
		: adjacent.querySelector<HTMLElement>(".segment-text");
	const adjacentSegment = text?.closest<HTMLElement>("[data-segment-key]") ?? null;
	if (text === null || adjacentSegment === null) return null;
	const boundaryOffset = edge === "end" ? text.childNodes.length : 0;
	return { segment: adjacentSegment, text, container: text, offset: boundaryOffset };
}

// Returns the character offset within a segment's text element up to a selection boundary.
function GetTextOffset(element: HTMLElement, container: Node, offset: number): number
{
	const range = document.createRange();
	range.selectNodeContents(element);
	range.setEnd(container, offset);
	const textOffset = range.toString().length;

	return textOffset;
}

// Captures the reader's current browser selection as a canonical TextSelection, or null when there is none.
export function CaptureSelection(work: TextDocument): TextSelection | null
{
	work = TextDocument.FromSnapshot(work);
	const selection = window.getSelection();
	let result: TextSelection | null = null;

	if (selection && selection.rangeCount > 0 && !selection.isCollapsed)
	{
		const range = selection.getRangeAt(0);
		const start = ResolveBoundary(range.startContainer, range.startOffset, "start");
		const end = ResolveBoundary(range.endContainer, range.endOffset, "end");

		if (start !== null && end !== null)
		{
			const startKey = start.segment.dataset.segmentKey ?? "";
			const endKey = end.segment.dataset.segmentKey ?? "";
			const startPosition = { segmentKey: startKey, offset: GetTextOffset(start.text, start.container, start.offset) };
			const endPosition = { segmentKey: endKey, offset: GetTextOffset(end.text, end.container, end.offset) };
			result = work.CreateSelection(startPosition, endPosition);
		}
	}

	return result;
}

// Clears the browser's native selection ranges.
export function ClearBrowserSelection(): void
{
	const selection = window.getSelection();

	if (selection) selection.removeAllRanges();
}

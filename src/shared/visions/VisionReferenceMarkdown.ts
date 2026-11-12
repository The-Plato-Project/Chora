import { AssertVisionReferencePlacement, type VisionReferencePlacement } from "./VisionReferenceTypes.js";

const DirectivePattern = /\{\{chora-(word|range)\|([^|{}\r\n]+)\|anchor=(anchor:sha256:[0-9a-f]{64})\|placement=(placement:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\|vision=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\}\}/gu;

export type VisionReferenceMarkdownPart = string | VisionReferencePlacement;

export interface VisionReferenceMarkdownRange
{
	readonly from: number;
	readonly to: number;
	readonly placement: VisionReferencePlacement;
}

// Builds bounded prose context around each exact placement without exposing stored directive metadata.
export function CreateVisionReferenceExcerpts(value: string, ranges: readonly VisionReferenceMarkdownRange[]): ReadonlyMap<string, string>
{
	let prose = "";
	let previous = 0;
	const positions: Array<{ id: string; from: number }> = [];
	for (const range of ranges)
	{
		const preceding = PlainExcerptText(value.slice(previous, range.from));
		prose += preceding;
		const from = prose.length;
		prose += range.placement.label;
		positions.push({ id: range.placement.id, from });
		previous = range.to;
	}
	if (ranges.length > 0) prose += PlainExcerptText(value.slice(previous));
	const excerpts = new Map<string, string>();
	for (const position of positions)
	{
		const start = Math.max(0, position.from - 90);
		const end = Math.min(prose.length, position.from + 170);
		let excerpt = prose.slice(start, end);
		if (start > 0) excerpt = excerpt.replace(/^\S*\s/u, "");
		if (end < prose.length) excerpt = excerpt.replace(/\s\S*$/u, "");
		excerpt = excerpt.trim();
		excerpts.set(position.id, `${start > 0 ? "…" : ""}${excerpt}${end < prose.length ? "…" : ""}`);
	}
	return excerpts;
}

// Removes presentation syntax from derived context, leaving the authoritative Markdown unchanged.
function PlainExcerptText(value: string): string
{
	const prose = value.replace(/&(?:#x20|#32|nbsp);/giu, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gmu, "")
		.replace(/[*_`]/gu, "")
		.replace(/\\\r?\n/gu, " ")
		.replace(/[-=]{3,}/gu, " ")
		.replace(/\s+/gu, " ");
	return prose;
}

export function SerializeVisionReference(placement: VisionReferencePlacement): string
{
	AssertVisionReferencePlacement(placement);
	const kind = placement.presentation === "inline-word" ? "word" : "range";
	const label = placement.presentation === "inline-word" ? placement.label : encodeURIComponent(placement.label);
	return `{{chora-${kind}|${label}|anchor=${placement.anchorId}|placement=${placement.id}|vision=${placement.visionId}}}`;
}

export function FindVisionReferenceRanges(value: string): readonly VisionReferenceMarkdownRange[]
{
	const ranges: VisionReferenceMarkdownRange[] = [];
	DirectivePattern.lastIndex = 0;
	let match = DirectivePattern.exec(value);
	while (match !== null)
	{
		const placement: VisionReferencePlacement = {
			id: match[4] ?? "",
			visionId: match[5] ?? "",
			anchorId: match[3] ?? "",
			presentation: match[1] === "word" ? "inline-word" : "inline-range",
			label: match[1] === "word" ? match[2] ?? "" : decodeURIComponent(match[2] ?? "")
		};
		AssertVisionReferencePlacement(placement);
		ranges.push({
			from: match.index,
			to: match.index + match[0].length,
			placement
		});
		match = DirectivePattern.exec(value);
	}
	return ranges;
}

export function ConcealVisionReferences(value: string): string
{
	const ranges = FindVisionReferenceRanges(value);
	let concealed = "";
	let start = 0;
	for (const range of ranges)
	{
		concealed += value.slice(start, range.from);
		concealed += `[[${range.placement.label}]]`;
		start = range.to;
	}
	return concealed + value.slice(start);
}

export function ParseVisionReferences(value: string): readonly VisionReferenceMarkdownPart[]
{
	const parts: VisionReferenceMarkdownPart[] = [];
	let start = 0;
	for (const range of FindVisionReferenceRanges(value))
	{
		if (range.from > start) parts.push(value.slice(start, range.from));
		parts.push(range.placement);
		start = range.to;
	}
	if (start < value.length) parts.push(value.slice(start));
	return parts;
}

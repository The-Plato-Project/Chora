import type { TextAnnotationSnapshot } from "../../shared/text/TextDocument.js";
import { EscapeHtml } from "../ui/Html.js";

// Renders one canonical text range while preserving direct quotations and their citations.
export function RenderSemanticText(
	text: string,
	annotations: readonly TextAnnotationSnapshot[] | undefined,
	start = 0,
	end = text.length): string
{
	const rangeStart = Math.max(0, Math.min(text.length, start));
	const rangeEnd = Math.max(rangeStart, Math.min(text.length, end));
	const semanticRanges = (annotations ?? []).filter(function IntersectsRange(annotation): boolean
	{
		return annotation.start < rangeEnd && annotation.end > rangeStart;
	}).map(function ClipRange(annotation): TextAnnotationSnapshot
	{
		return {
			kind: annotation.kind,
			start: Math.max(annotation.start, rangeStart),
			end: Math.min(annotation.end, rangeEnd)
		};
	});
	let markup = "";
	let offset = rangeStart;

	for (let index = 0; index < semanticRanges.length; index += 1)
	{
		const annotation = semanticRanges[index];
		if (annotation === undefined || annotation.start < offset)
		{
			continue;
		}

		markup += EscapeHtml(text.slice(offset, annotation.start));

		if (annotation.kind === "quotation")
		{
			markup += `<span class="source-quotation" role="blockquote"><span class="source-quotation-text">${EscapeHtml(text.slice(annotation.start, annotation.end))}</span>`;
			offset = annotation.end;
			const citation = semanticRanges[index + 1];

			if (citation !== undefined
				&& citation.kind === "citation"
				&& citation.start >= offset
				&& text.slice(offset, citation.start).trim().length === 0)
			{
				markup += EscapeHtml(text.slice(offset, citation.start));
				markup += `<cite class="source-quotation-citation">${EscapeHtml(text.slice(citation.start, citation.end))}</cite>`;
				offset = citation.end;
				index += 1;
			}

			markup += "</span>";
		}
		else
		{
			markup += `<cite class="source-quotation-citation">${EscapeHtml(text.slice(annotation.start, annotation.end))}</cite>`;
			offset = annotation.end;
		}
	}

	markup += EscapeHtml(text.slice(offset, rangeEnd));

	return markup;
}

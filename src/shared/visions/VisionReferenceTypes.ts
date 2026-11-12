import type { TextAnchorKind, TextAnchorSnapshot } from "../anchors/TextAnchorTypes.js";
import { DecodeTextSelection, type TextSelection } from "../text/TextSelection.js";

export type VisionReferencePresentation = "inline-word" | "inline-range";
export const VisionReferenceDragMime = "application/x-chora-text-selection";

export interface VisionReferenceDragPayload
{
	readonly selection: TextSelection;
	readonly anchorKind: Extract<TextAnchorKind, "word" | "phrase" | "passage">;
}

export function CreateVisionReferencePayload(selection: TextSelection, exactWordSelection: TextSelection | null): VisionReferenceDragPayload
{
	const exactWord = exactWordSelection !== null
		&& exactWordSelection.start.stephanus === selection.start.stephanus
		&& exactWordSelection.start.offset === selection.start.offset
		&& exactWordSelection.end.stephanus === selection.end.stephanus
		&& exactWordSelection.end.offset === selection.end.offset;
	return {
		selection,
		anchorKind: exactWord
			? "word"
			: selection.start.stephanus === selection.end.stephanus
				? "phrase"
				: "passage"
	};
}

export interface VisionReferencePlacement
{
	readonly id: string;
	readonly visionId: string;
	readonly anchorId: string;
	readonly presentation: VisionReferencePresentation;
	readonly label: string;
}

export function SerializeVisionReferenceDrag(payload: VisionReferenceDragPayload): string
{
	return JSON.stringify(payload);
}

export function DecodeVisionReferenceDrag(value: string): VisionReferenceDragPayload
{
	const record = JSON.parse(value) as Record<string, unknown> | null;
	if (record === null
		|| typeof record !== "object"
		|| Object.keys(record).sort().join(",") !== "anchorKind,selection"
		|| (record.anchorKind !== "word" && record.anchorKind !== "phrase" && record.anchorKind !== "passage"))
	{
		throw new Error("The dragged Vision reference is invalid.");
	}
	return {
		selection: DecodeTextSelection(record.selection),
		anchorKind: record.anchorKind
	};
}

export function SerializeVisionReferenceClipboardHtml(payload: VisionReferenceDragPayload, selectedText: string): string
{
	const serialized = encodeURIComponent(SerializeVisionReferenceDrag(payload));
	const escapedText = selectedText
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
	return `<span data-chora-text-selection="${serialized}">${escapedText}</span>`;
}

export function DecodeVisionReferenceClipboardHtml(value: string): VisionReferenceDragPayload | null
{
	const match = /data-chora-text-selection="([^"]+)"/u.exec(value);
	if (match === null) return null;
	return DecodeVisionReferenceDrag(decodeURIComponent(match[1] ?? ""));
}

export function CreateVisionWordReferencePlacement(visionId: string, anchor: TextAnchorSnapshot, id = crypto.randomUUID()): VisionReferencePlacement
{
	return CreateVisionReferencePlacement(visionId, anchor, id);
}

export function CreateVisionReferencePlacement(visionId: string, anchor: TextAnchorSnapshot, id = crypto.randomUUID()): VisionReferencePlacement
{
	const placement: VisionReferencePlacement = {
		id: `placement:${id}`,
		visionId,
		anchorId: anchor.id,
		presentation: anchor.kind === "word" ? "inline-word" : "inline-range",
		label: anchor.selectedText
	};
	AssertVisionReferencePlacement(placement);
	return placement;
}

export function AssertVisionReferencePlacement(placement: VisionReferencePlacement): void
{
	if (!/^placement:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(placement.id)
		|| !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(placement.visionId)
		|| !/^anchor:sha256:[0-9a-f]{64}$/u.test(placement.anchorId)
		|| (placement.presentation !== "inline-word" && placement.presentation !== "inline-range")
		|| placement.label.length === 0
		|| (placement.presentation === "inline-word" && /[|{}\r\n]/u.test(placement.label)))
	{
		throw new Error("The Vision reference placement is invalid.");
	}
}

import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import type { MarkdownNode, Root } from "@milkdown/kit/transformer";
import { ParseVisionReferences, SerializeVisionReference } from "../../shared/visions/VisionReferenceMarkdown.js";
import type { VisionReferencePlacement } from "../../shared/visions/VisionReferenceTypes.js";

interface MutableMarkdownNode extends MarkdownNode
{
	children?: MutableMarkdownNode[];
	type: string;
	value?: string;
}

function RenderReferenceContents(label: string, presentation: string): Array<string | [string, Record<string, string>, string]>
{
	if (presentation === "inline-word") return [label];
	const contents: Array<string | [string, Record<string, string>, string]> = [];
	const pattern = /(?:(?=\p{Script=Greek})\p{L}|\p{M})+/gu;
	let start = 0;
	let match = pattern.exec(label);
	while (match !== null)
	{
		const wordStart = match.index;
		const word = match[0];
		if (wordStart > start) contents.push(label.slice(start, wordStart));
		contents.push(["span", {
			"data-vision-range-word": "",
			"data-word-start": String(wordStart),
			"data-word-end": String(wordStart + word.length)
		}, word]);
		start = wordStart + word.length;
		match = pattern.exec(label);
	}
	if (start < label.length) contents.push(label.slice(start));
	return contents;
}

function TransformReferenceDirectives(node: MutableMarkdownNode): void
{
	if (node.type === "code" || node.type === "inlineCode") return;
	if (node.children !== undefined)
	{
		const children: MutableMarkdownNode[] = [];
		for (const child of node.children)
		{
			if (child.type === "text" && typeof child.value === "string")
			{
				const parts = ParseVisionReferences(child.value);
				for (const part of parts)
				{
					if (typeof part === "string")
					{
						if (part.length > 0) children.push({ type: "text", value: part });
					}
					else children.push({ type: "visionReference", ...part });
				}
			}
			else
			{
				TransformReferenceDirectives(child);
				children.push(child);
			}
		}
		node.children = children;
	}
}

export const visionReferenceRemark = $remark("vision-reference-directives", () => () => (tree: Root) =>
{
	TransformReferenceDirectives(tree as unknown as MutableMarkdownNode);
});

export const visionReferenceSchema = $nodeSchema("vision_reference", () => ({
	group: "inline",
	inline: true,
	atom: true,
	selectable: true,
	isolating: true,
	marks: "",
	attrs: {
		id: { default: "", validate: "string" },
		visionId: { default: "", validate: "string" },
		anchorId: { default: "", validate: "string" },
		presentation: { default: "inline-word", validate: "string" },
		label: { default: "", validate: "string" }
	},
	parseDOM: [{
		tag: "span[data-vision-reference]",
		getAttrs: (dom: HTMLElement) => ({
			id: dom.dataset.placementId ?? "",
			visionId: dom.dataset.visionId ?? "",
			anchorId: dom.dataset.anchorId ?? "",
			presentation: dom.dataset.visionReference ?? "",
			label: dom.textContent ?? ""
		})
	}],
	toDOM: (node) =>
	{
		const presentation = node.attrs.presentation as string;
		return ["span", {
			class: presentation === "inline-word" ? "vision-word-reference" : "vision-range-reference",
			"data-vision-reference": presentation,
			"data-placement-id": node.attrs.id,
			"data-vision-id": node.attrs.visionId,
			"data-anchor-id": node.attrs.anchorId,
			contenteditable: "false",
			draggable: "false",
			title: presentation === "inline-word" ? "Open word" : "Linked Greek text"
		}, ...RenderReferenceContents(node.attrs.label as string, presentation)];
	},
	parseMarkdown: {
		match: (node) => node.type === "visionReference",
		runner: (state, node, type) =>
		{
			const placement = node as unknown as VisionReferencePlacement;
			state.addNode(type, {
				id: placement.id,
				visionId: placement.visionId,
				anchorId: placement.anchorId,
				presentation: placement.presentation,
				label: placement.label
			});
		}
	},
	toMarkdown: {
		match: (node) => node.type.name === "vision_reference",
		runner: (state, node) =>
		{
			const placement: VisionReferencePlacement = {
				id: node.attrs.id,
				visionId: node.attrs.visionId,
				anchorId: node.attrs.anchorId,
				presentation: node.attrs.presentation,
				label: node.attrs.label
			};
			state.addNode("text", undefined, SerializeVisionReference(placement));
		}
	}
}));

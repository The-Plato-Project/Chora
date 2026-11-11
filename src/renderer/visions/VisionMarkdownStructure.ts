import { Fragment, Slice, type Node } from "@milkdown/kit/prose/model";

// Repairs paragraph boundaries represented by repeated hard breaks without rewriting reader prose.
export class VisionMarkdownStructure
{
	// Normalizes parsed Vision structure once when loading a document.
	public static NormalizeDocument(document: Node): Node
	{
		const content = VisionMarkdownStructure.NormalizeChildren(document);
		const normalized = document.copy(content);
		return normalized;
	}

	// Applies the same structure rules to pasted content before it enters the document.
	public static NormalizePaste(slice: Slice): Slice
	{
		const nodes: Node[] = [];
		slice.content.forEach(function NormalizeChild(node): void
		{
			const normalized = VisionMarkdownStructure.NormalizeNode(node);
			nodes.push(...normalized);
		});
		const content = Fragment.fromArray(nodes);
		const normalized = new Slice(content, slice.openStart, slice.openEnd);
		return normalized;
	}

	// Retains enclosing lists, quotations, and tables while repairing their text blocks.
	private static NormalizeChildren(parent: Node): Fragment
	{
		const nodes: Node[] = [];
		parent.forEach(function NormalizeChild(node): void
		{
			const normalized = VisionMarkdownStructure.NormalizeNode(node);
			nodes.push(...normalized);
		});
		const content = Fragment.fromArray(nodes);
		return content;
	}

	// Leaves code and atomic reference nodes intact.
	private static NormalizeNode(node: Node): readonly Node[]
	{
		let normalized: readonly Node[] = [node];
		if (node.type.name === "paragraph" || node.type.name === "heading")
		{
			normalized = VisionMarkdownStructure.NormalizeTextBlock(node);
		}
		else if (!node.isLeaf && !node.isInline && node.type.spec.code !== true)
		{
			const content = VisionMarkdownStructure.NormalizeChildren(node);
			const copy = node.copy(content);
			normalized = [copy];
		}
		return normalized;
	}

	// Treats a run of blank hard-break lines as a paragraph boundary, preserving single line breaks.
	private static NormalizeTextBlock(node: Node): readonly Node[]
	{
		const fragments: Fragment[] = [];
		let current: Node[] = [];
		let breaks: Node[] = [];
		node.forEach(function CollectLine(child): void
		{
			if (child.type.name === "hardbreak" && child.attrs.isInline !== true)
			{
				breaks.push(child);
			}
			else
			{
				if (breaks.length >= 2 && current.length > 0)
				{
					const fragment = Fragment.fromArray(current);
					fragments.push(fragment);
					current = [];
				}
				else if (current.length > 0)
				{
					current.push(...breaks);
				}
				breaks = [];
				current.push(child);
			}
		});
		if (current.length > 0)
		{
			const fragment = Fragment.fromArray(current);
			fragments.push(fragment);
		}
		const normalized: Node[] = [];
		for (const fragment of fragments)
		{
			let content = VisionMarkdownStructure.TrimParagraphEdges(fragment);
			const heading = node.type.name === "heading" && normalized.length === 0;
			if (heading)
			{
				const inline: Node[] = [];
				content.forEach(function FlattenHeadingLine(child): void
				{
					if (child.type.name === "hardbreak")
					{
						const space = node.type.schema.text(" ");
						inline.push(space);
					}
					else
					{
						inline.push(child);
					}
				});
				content = Fragment.fromArray(inline);
			}
			if (content.size > 0)
			{
				const type = heading ? node.type : node.type.schema.nodes.paragraph!;
				const attributes = heading ? node.attrs : null;
				const block = type.create(attributes, content, node.marks);
				normalized.push(block);
			}
		}
		if (normalized.length === 0)
		{
			const empty = node.copy(Fragment.empty);
			normalized.push(empty);
		}
		return normalized;
	}

	// Removes incidental indentation that otherwise becomes encoded leading spaces in prose.
	private static TrimParagraphEdges(fragment: Fragment): Fragment
	{
		let content = fragment;
		while (content.firstChild?.isText && content.firstChild.marks.length === 0)
		{
			const text = content.firstChild.text ?? "";
			const spaces = text.match(/^[\t ]+/u)?.[0].length ?? 0;
			if (spaces === 0) break;
			content = content.cut(spaces);
		}
		while (content.lastChild?.isText && content.lastChild.marks.length === 0)
		{
			const text = content.lastChild.text ?? "";
			const spaces = text.match(/[\t ]+$/u)?.[0].length ?? 0;
			if (spaces === 0) break;
			content = content.cut(0, content.size - spaces);
		}
		return content;
	}
}

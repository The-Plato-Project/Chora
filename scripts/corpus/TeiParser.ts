import { DOMParser, type Document as XmlDocument, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";

const ElementNodeType = 1;
const TextNodeType = 3;
const QuotationStartMarker = "\uE000";
const QuotationEndMarker = "\uE001";
const CitationStartMarker = "\uE002";
const CitationEndMarker = "\uE003";

export interface ParsedTeiAnnotation
{
	kind: "quotation" | "citation";
	start: number;
	end: number;
}

export interface ParsedTeiSegment
{
	key: string;
	citation: {
		system: string;
		value: string;
	} | null;
	division: {
		type: string;
		label: string;
	} | null;
	text: string;
	annotations?: ParsedTeiAnnotation[];
}

export interface ParsedTeiWork
{
	id: string;
	title: string;
	titleGreek: string | null;
	author: string;
	language: string;
	editor: string | null;
	sourceFile: string;
	segments: ParsedTeiSegment[];
}

class SegmentCollector
{
	private readonly segments: ParsedTeiSegment[] = [];
	private readonly sourceFile: string;
	private currentCitation: ParsedTeiSegment["citation"] = null;
	private currentDivision: ParsedTeiSegment["division"] = null;
	private currentText = "";
	private segmentIndex = 0;
	private quotationLineCount = 0;

	public constructor(sourceFile: string)
	{
		this.sourceFile = sourceFile;
	}

	public ParseBlock(block: XmlElement): void
	{
		this.currentDivision = ReadDivision(block);
		this.ParseChildren(block);
		this.FlushSegment();
	}

	public GetSegments(): ParsedTeiSegment[]
	{
		const segments = this.segments;
		return segments;
	}

	private ParseChildren(node: XmlNode): void
	{
		for (let index = 0; index < node.childNodes.length; index += 1)
		{
			const childNode = node.childNodes.item(index);

			if (childNode)
			{
				this.ParseNode(childNode);
			}
		}
	}

	private ParseNode(node: XmlNode): void
	{
		if (node.nodeType === TextNodeType)
		{
			const textValue = node.nodeValue ?? "";
			this.AppendText(textValue);
		}

		if (node.nodeType === ElementNodeType)
		{
			const element = node as XmlElement;
			const elementName = element.localName;

			if (elementName === "milestone")
			{
				this.ReadMilestone(element);
			}

			if (elementName === "lb")
			{
				this.AppendBreak();
			}

			if (elementName === "quote")
			{
				if (HasAncestor(element, "cit"))
				{
					this.ParseQuotation(element);
				}
				else
				{
					this.ParseChildren(element);
				}
			}

			if (elementName === "bibl")
			{
				if (HasAncestor(element, "cit"))
				{
					this.ParseAnnotation(element, CitationStartMarker, CitationEndMarker);
				}
				else
				{
					this.ParseChildren(element);
				}
			}

			if (elementName === "l")
			{
				this.ParseQuotationLine(element);
			}

			if (elementName !== "milestone"
				&& elementName !== "lb"
				&& elementName !== "quote"
				&& elementName !== "bibl"
				&& elementName !== "l")
			{
				this.ParseChildren(element);
			}
		}
	}

	private ParseQuotation(element: XmlElement): void
	{
		const previousLineCount = this.quotationLineCount;
		this.quotationLineCount = 0;
		this.currentText += QuotationStartMarker;
		this.ParseChildren(element);
		this.currentText += QuotationEndMarker;
		this.quotationLineCount = previousLineCount;
	}

	private ParseQuotationLine(element: XmlElement): void
	{
		if (this.quotationLineCount > 0)
		{
			this.AppendBreak();
		}
		this.quotationLineCount += 1;
		this.ParseChildren(element);
	}

	private ParseAnnotation(element: XmlElement, startMarker: string, endMarker: string): void
	{
		this.currentText += startMarker;
		this.ParseChildren(element);
		this.currentText += endMarker;
	}

	private ReadMilestone(element: XmlElement): void
	{
		const unit = GetAttributeValue(element, "unit");
		const response = GetAttributeValue(element, "resp");
		const locatorValue = GetAttributeValue(element, "n");
		const isSection = unit === "section" && response?.toLowerCase() === "stephanus";
		const isParagraph = unit === "para";

		if (isSection)
		{
			this.FlushSegment();
			this.currentCitation = CreateCitation(response, locatorValue);
		}

		if (isParagraph)
		{
			this.FlushSegment();
		}
	}

	private AppendText(value: string): void
	{
		const normalizedValue = value.replace(/\s+/g, " ");
		this.currentText += normalizedValue;
	}

	private AppendBreak(): void
	{
		this.currentText += "\n";
	}

	private FlushSegment(): void
	{
		const parsed = ParseStructuredText(this.currentText);
		const text = parsed.text;

		if (text.length > 0)
		{
			const key = CreateSegmentKey(this.sourceFile, this.segmentIndex);
			const segment: ParsedTeiSegment = {
				key,
				citation: this.currentCitation,
				division: this.currentDivision,
				text,
				...(parsed.annotations.length > 0 ? { annotations: parsed.annotations } : {})
			};
			this.segments.push(segment);
			this.segmentIndex += 1;
		}

		function ParseStructuredText(value: string): { text: string; annotations: ParsedTeiAnnotation[] }
		{
			let normalized = NormalizeText(value);
			normalized = normalized.replace(new RegExp(` *${QuotationStartMarker} *`, "gu"), `\n${QuotationStartMarker}`);
			normalized = normalized.replace(new RegExp(` *${QuotationEndMarker} *`, "gu"), `${QuotationEndMarker}\n`);
			normalized = normalized.replace(new RegExp(` *${CitationStartMarker} *`, "gu"), CitationStartMarker);
			normalized = normalized.replace(new RegExp(` *${CitationEndMarker} *`, "gu"), `${CitationEndMarker}\n`);
			const annotations: ParsedTeiAnnotation[] = [];
			const starts = new Map<string, number>();
			let text = "";

			for (const character of normalized)
			{
				if (character === QuotationStartMarker || character === CitationStartMarker)
				{
					starts.set(character, text.length);
				}
				else if (character === QuotationEndMarker || character === CitationEndMarker)
				{
					const startMarker = character === QuotationEndMarker ? QuotationStartMarker : CitationStartMarker;
					const start = starts.get(startMarker);
					if (start !== undefined && start < text.length)
					{
						annotations.push({
							kind: character === QuotationEndMarker ? "quotation" : "citation",
							start,
							end: text.length
						});
					}
					starts.delete(startMarker);
				}
				else
				{
					text += character;
				}
			}

			const leadingWhitespace = text.length - text.trimStart().length;
			const trimmedText = text.trim();
			const adjusted = annotations.map(function AdjustAnnotation(annotation): ParsedTeiAnnotation
			{
				return {
					...annotation,
					start: Math.max(0, annotation.start - leadingWhitespace),
					end: Math.min(trimmedText.length, annotation.end - leadingWhitespace)
				};
			}).filter(function HasContent(annotation): boolean
			{
				return annotation.start < annotation.end;
			});

			return { text: trimmedText, annotations: adjusted };
		}

		this.currentText = "";
	}
}

function ReadDivision(element: XmlElement): ParsedTeiSegment["division"]
{
	let ancestor: XmlNode | null = element.parentNode;
	let division: ParsedTeiSegment["division"] = null;

	while (ancestor !== null && division === null)
	{
		if (ancestor.nodeType === ElementNodeType)
		{
			const ancestorElement = ancestor as XmlElement;
			const subtype = GetAttributeValue(ancestorElement, "subtype");
			const value = GetAttributeValue(ancestorElement, "n");

			if (ancestorElement.localName === "div" && subtype === "book" && value !== null)
			{
				division = { type: "book", label: value };
			}

		}

		ancestor = ancestor.parentNode;
	}

	return division;
}

function HasAncestor(element: XmlElement, ancestorName: string): boolean
{
	let ancestor = element.parentNode;
	let matches = false;

	while (ancestor !== null && !matches)
	{
		if (ancestor.nodeType === ElementNodeType)
		{
			matches = (ancestor as XmlElement).localName === ancestorName;
		}

		ancestor = ancestor.parentNode;
	}

	return matches;
}

function NormalizeText(value: string): string
{
	const normalizedLines = value.replace(/[ \t]*\n[ \t]*/g, "\n");
	const normalizedText = normalizedLines.replace(/[ \t]+/g, " ");
	const trimmedText = normalizedText.trim();
	const composedText = trimmedText.normalize("NFC");
	return composedText;
}

function GetAttributeValue(element: XmlElement, attributeName: string): string | null
{
	const value = element.getAttribute(attributeName);
	let attributeValue: string | null = null;

	if (value && value.length > 0)
	{
		attributeValue = value;
	}

	return attributeValue;
}

function CreateCitation(response: string | null, value: string | null): ParsedTeiSegment["citation"]
{
	const system = response?.toLowerCase() ?? "generic";
	const citationValue = value ?? "";
	const citation = citationValue.length > 0
		? {
			system,
			value: citationValue
		}
		: null;
	return citation;
}

function CreateSegmentKey(sourceFile: string, segmentIndex: number): string
{
	const indexText = String(segmentIndex).padStart(5, "0");
	const key = `${sourceFile}-${indexText}`;
	return key;
}

function IsBlock(element: XmlElement): boolean
{
	const elementName = element.localName;
	const isBlock = elementName === "p" || elementName === "sp" || elementName === "lg";
	return isBlock;
}

function CollectBlocks(node: XmlNode, blocks: XmlElement[]): void
{
	if (node.nodeType === ElementNodeType)
	{
		const element = node as XmlElement;
		const isBlock = IsBlock(element);

		if (isBlock)
		{
			blocks.push(element);
		}

		if (!isBlock)
		{
			for (let index = 0; index < node.childNodes.length; index += 1)
			{
				const childNode = node.childNodes.item(index);

				if (childNode)
				{
					CollectBlocks(childNode, blocks);
				}
			}
		}
	}
}

// Reads all descendant text without inferring presentation metadata.
function GetText(node: XmlNode): string
{
	let text = "";

	if (node.nodeType === TextNodeType)
	{
		text = node.nodeValue ?? "";
	}
	else
	{
		for (let index = 0; index < node.childNodes.length; index += 1)
		{
			const childNode = node.childNodes.item(index);

			if (childNode !== null)
			{
				text += GetText(childNode);
			}
		}
	}

	return text;
}

function ReadTitle(document: XmlDocument): string
{
	const titleNodes = document.getElementsByTagNameNS("*", "title");
	const titleNode = titleNodes.item(0);
	const titleText = titleNode ? GetText(titleNode) : "Untitled";
	const title = NormalizeText(titleText);
	return title;
}

function ReadAuthor(document: XmlDocument): string
{
	const authorNodes = document.getElementsByTagNameNS("*", "author");
	const authorNode = authorNodes.item(0);
	const authorText = authorNode ? GetText(authorNode) : "Unknown";
	const author = NormalizeText(authorText);
	return author;
}

function ReadEditor(document: XmlDocument): string | null
{
	const editorNodes = document.getElementsByTagNameNS("*", "editor");
	const editorNode = editorNodes.item(0);
	const editorText = editorNode ? GetText(editorNode) : "";
	const normalizedEditor = NormalizeText(editorText);
	const editor = normalizedEditor.length > 0 ? normalizedEditor : null;
	return editor;
}

function ReadBlocks(document: XmlDocument): XmlElement[]
{
	const bodyNodes = document.getElementsByTagNameNS("*", "body");
	const bodyNode = bodyNodes.item(0);
	const blocks: XmlElement[] = [];

	if (bodyNode)
	{
		CollectBlocks(bodyNode, blocks);
	}

	return blocks;
}

export function ParseTeiWork(xmlText: string, sourceFile: string): ParsedTeiWork
{
	const document = new DOMParser().parseFromString(xmlText, "application/xml");
	const title = ReadTitle(document);
	const author = ReadAuthor(document);
	const editor = ReadEditor(document);
	const blocks = ReadBlocks(document);
	const collector = new SegmentCollector(sourceFile);

	for (const block of blocks)
	{
		collector.ParseBlock(block);
	}

	const segments = collector.GetSegments();
	const workId = sourceFile.replace(/\.xml$/i, "");
	const parsedWork: ParsedTeiWork = {
		id: workId,
		title,
		titleGreek: title,
		author,
		language: "grc",
		editor,
		sourceFile,
		segments
	};
	return parsedWork;
}

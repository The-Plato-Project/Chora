import { ApplicationError } from "../../shared/diagnostics/OperationResult.js";
import type { LibraryTextSummary } from "../../shared/library/LibraryTypes.js";
import { TextDocument, type TextAnnotationSnapshot, type TextDocumentSnapshot, type TextSegmentSnapshot } from "../../shared/text/TextDocument.js";
import type { CanonicalEntry, CanonicalSection, PlatoSiApi } from "../platosi/PlatoSiGateway.js";

// Adapts canonical PlatoSI works to Chora's immutable reader document.
export class PlatoSiLibraryRepository
{
	private catalogueRequest: Promise<readonly CanonicalEntry[]> | null = null;

	public constructor(private readonly platosi: PlatoSiApi)
	{
	}

	public async ListAsync(): Promise<LibraryTextSummary[]>
	{
		const catalogue = await this.GetCatalogueAsync();
		return catalogue.map(function CreateSummary(entry): LibraryTextSummary
		{
			return {
				id: entry.dialogue,
				urn: null,
				title: entry.title,
				titleGreek: entry.titleGreek,
				author: entry.author,
				language: entry.language,
				editor: null
			};
		});
	}

	public async GetAsync(textId: string): Promise<TextDocument>
	{
		const catalogue = await this.GetCatalogueAsync();
		const entry = catalogue.find(function FindDialogue(item): boolean
		{
			return item.dialogue === textId;
		});
		if (entry === undefined)
		{
			throw ApplicationError.Expected("not-found", "TEXT_NOT_FOUND", `PlatoSI does not provide ${textId}.`);
		}

		const work = await this.platosi.GetCanonicalWorkAsync(textId, entry.textVersion);
		const snapshot: TextDocumentSnapshot = {
			id: entry.dialogue,
			textVersion: entry.textVersion,
			urn: work.source.textId,
			title: entry.title,
			titleGreek: entry.titleGreek,
			author: entry.author,
			language: entry.language,
			edition: {
				editor: null,
				title: null,
				volume: null,
				publisher: null,
				publicationPlace: null,
				publicationDate: null
			},
			provenance: {
				sourceKind: "platosi",
				repository: work.source.repository,
				commit: work.source.revision,
				sourceFile: work.source.sourceFile,
				license: work.source.license
			},
			segments: work.sections.map(CreateSectionSegment)
		};
		return TextDocument.FromSnapshot(snapshot);
	}

	private async GetCatalogueAsync(): Promise<readonly CanonicalEntry[]>
	{
		if (this.catalogueRequest === null)
		{
			this.catalogueRequest = this.platosi.GetCanonicalCatalogueAsync();
		}
		try
		{
			return await this.catalogueRequest;
		}
		catch (error)
		{
			this.catalogueRequest = null;
			throw error;
		}
	}
}

function CreateSectionSegment(section: CanonicalSection): TextSegmentSnapshot
{
	const annotations: TextAnnotationSnapshot[] = [];
	let sectionOffset = 0;
	for (const segment of section.segments)
	{
		for (const annotation of segment.annotations)
		{
			annotations.push({
				kind: annotation.kind,
				start: sectionOffset + annotation.start,
				end: sectionOffset + annotation.end
			});
		}
		sectionOffset += segment.text.length + 1;
	}
	return {
		key: section.stephanus,
		citation: { system: "stephanus", value: section.stephanus },
		division: section.division,
		text: section.segments.map(function ReadText(segment): string
		{
			return segment.text;
		}).join("\n"),
		annotations
	};
}

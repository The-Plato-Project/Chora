import type { LibraryTextSummary, SourceNotice } from "../../shared/library/LibraryTypes.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";

// Supplies the catalogue and exact text used by Library workflows.
export interface LibraryReader
{
	ListAsync(): Promise<LibraryTextSummary[]>;
	GetAsync(textId: string): Promise<TextDocument>;
}

export class LibraryService
{
	// Shares immutable PlatoSI documents across renderer workflows.
	private readonly documents = new Map<string, Promise<TextDocument>>();

	public constructor(private readonly repository: LibraryReader)
	{
	}

	public ListAsync(): Promise<LibraryTextSummary[]>
	{
		return this.repository.ListAsync();
	}

	public async GetAsync(textId: string): Promise<TextDocument>
	{
		let request = this.documents.get(textId);
		if (request === undefined)
		{
			request = this.repository.GetAsync(textId);
			this.documents.set(textId, request);
		}
		let document: TextDocument;
		try
		{
			document = await request;
		}
		catch (error)
		{
			if (this.documents.get(textId) === request)
			{
				this.documents.delete(textId);
			}
			throw error;
		}
		return document;
	}

	public async GetSourceNoticeAsync(textId: string): Promise<SourceNotice>
	{
		const text = await this.GetAsync(textId);
		const notice: SourceNotice = {
			source: "Perseus Digital Library",
			editor: text.edition.editor,
			editionTitle: text.edition.title,
			repository: text.provenance.repository,
			license: text.provenance.license
		};
		return notice;
	}
}

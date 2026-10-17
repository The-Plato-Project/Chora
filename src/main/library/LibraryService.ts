import type { LibraryTextSummary, SourceNotice } from "../../shared/library/LibraryTypes.js";
import type { TextDocument } from "../../shared/text/TextDocument.js";
import { LibraryRepository } from "./LibraryRepository.js";

export class LibraryService
{
	public constructor(private readonly repository: LibraryRepository)
	{
	}

	public ListAsync(): Promise<LibraryTextSummary[]>
	{
		return this.repository.ListAsync();
	}

	public GetAsync(textId: string): Promise<TextDocument>
	{
		return this.repository.GetAsync(textId);
	}

	public async GetSourceNoticeAsync(textId: string): Promise<SourceNotice>
	{
		const text = await this.repository.GetAsync(textId);
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

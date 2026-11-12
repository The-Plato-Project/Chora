import type { CanonicalTextSearch, LibraryTextSummary, SourceNotice } from "../../shared/library/LibraryTypes.js";
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

	// Searches the entire authoritative Greek work; never substitutes Vision prose or model memory.
	public async SearchAsync(textId: string, terms: readonly string[], offset = 0): Promise<CanonicalTextSearch>
	{
		if (terms.length === 0 || terms.length > 8 || !Number.isSafeInteger(offset) || offset < 0)
		{
			throw new Error("Provide one to eight Greek search terms and a nonnegative page offset.");
		}
		const normalized: string[] = [];
		for (const term of terms)
		{
			if (typeof term !== "string" || term.length > 80 || !/\p{Script=Greek}/u.test(term))
			{
				throw new Error("Canonical search requires Greek words or stems, not English topic labels.");
			}
			const query = this.NormalizeSearch(term.trim());
			if (query.length < 2) throw new Error("Use at least two letters in each Greek search term.");
			normalized.push(query);
		}
		const document = await this.GetAsync(textId);
		const matches: CanonicalTextSearch["items"][number][] = [];
		for (const segment of document.segments)
		{
			const text = this.NormalizeSearch(segment.text);
			const matchedTerms: string[] = [];
			let first = text.length;
			for (let index = 0; index < normalized.length; index += 1)
			{
				const position = text.indexOf(normalized[index]!);
				if (position >= 0)
				{
					matchedTerms.push(terms[index]!);
					first = Math.min(first, position);
				}
			}
			if (matchedTerms.length > 0)
			{
				// Map normalized offsets back to original UTF-16 text, retaining combining marks.
				let original = 0;
				let length = 0;
				for (const character of segment.text)
				{
					if (length >= first) break;
					length += this.NormalizeSearch(character).length;
					original += character.length;
				}
				const start = Math.max(0, original - 200);
				const selection = document.CreateSelection({ stephanus: segment.key, offset: 0 }, { stephanus: segment.key, offset: segment.text.length });
				matches.push({ stephanus: segment.key, matchedTerms, excerpt: segment.text.slice(start, start + 1200),
					excerptOffset: start, truncated: start > 0 || segment.text.length > start + 1200, selection });
			}
		}
		const result: CanonicalTextSearch = { workId: document.id, textVersion: document.textVersion,
			method: "Any Greek term or stem as a substring; case, accents and final sigma normalized. Entire work scanned. Lexical candidates, not exhaustive conceptual matches.",
			terms: [...terms], items: matches.slice(offset, offset + 6), total: matches.length,
			nextOffset: offset + 6 < matches.length ? offset + 6 : null };
		return result;
	}

	// Matches polytonic and unaccented Greek without changing canonical storage.
	private NormalizeSearch(value: string): string
	{
		const decomposed = value.normalize("NFD");
		const unaccented = decomposed.replace(/\p{M}/gu, "");
		const lower = unaccented.toLowerCase();
		const result = lower.replace(/ς/gu, "σ");
		return result;
	}
}

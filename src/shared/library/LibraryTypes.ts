import type { TextSelection } from "../text/TextSelection.js";

// A bounded lexical search over the canonical work, independent of reader writing.
export interface CanonicalTextSearch
{
	// Identity and version of the complete work searched.
	readonly workId: string;
	readonly textVersion: string;
	// Explicit matching rules prevent lexical results being mistaken for semantic coverage.
	readonly method: string;
	readonly terms: readonly string[];
	// Each result identifies an exact canonical section and a bounded context window.
	readonly items: readonly {
		readonly stephanus: string;
		readonly excerpt: string;
		readonly excerptOffset: number;
		readonly truncated: boolean;
		readonly matchedTerms: readonly string[];
		readonly selection: TextSelection;
	}[];
	// Pagination counts sections, not individual term occurrences.
	readonly total: number;
	readonly nextOffset: number | null;
}

// Canonical text-domain classes are re-exported for the Library catalogue boundary.
export { TextDocument, TextSegment } from "../text/TextDocument.js";
export type {
	CitationSnapshot,
	DocumentDivisionSnapshot,
	TextAnnotationSnapshot,
	TextDocumentSnapshot,
	TextSegmentSnapshot
} from "../text/TextDocument.js";

export interface LibraryTextSummary {
	id: string;
	urn: string | null;
	title: string;
	titleGreek: string | null;
	author: string;
	language: string;
	editor: string | null;
}

export interface SourceNotice {
	source: string;
	editor: string | null;
	editionTitle: string | null;
	repository: string;
	license: string;
}

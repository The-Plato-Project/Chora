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

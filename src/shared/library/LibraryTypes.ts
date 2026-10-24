// Canonical text-domain classes are re-exported for the Library catalogue boundary.
export { TextDocument, TextSegment } from "../text/TextDocument.js";
export type {
	CitationSnapshot,
	DocumentDivisionSnapshot,
	TextAnnotationSnapshot,
	TextDocumentSnapshot,
	TextSegmentSnapshot
} from "../text/TextDocument.js";

export interface LibraryManifest {
	id: string;
	title: string;
	author: string;
	language: string;
	sourceRepository: string;
	sourceCommit: string;
	license: string;
	works: LibraryTextSummary[];
}

export interface LibraryTextSummary {
	id: string;
	urn: string | null;
	title: string;
	titleGreek: string | null;
	author: string;
	language: string;
	editor: string | null;
	fileName: string;
}

export interface SourceNotice {
	source: string;
	editor: string | null;
	editionTitle: string | null;
	repository: string;
	license: string;
}

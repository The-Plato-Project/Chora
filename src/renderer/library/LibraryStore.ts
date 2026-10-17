import { TextDocument, type LibraryTextSummary, type SourceNotice } from "../../shared/library/LibraryTypes.js";
import type { TextSelection } from "../../shared/text/TextSelection.js";

// Immutable snapshot of the full Library state, for callers that need every field at once.
export interface LibrarySnapshot
{
	// All texts available in the Library catalogue.
	texts: readonly LibraryTextSummary[];
	// The text currently open for reading, or null when none is open.
	text: TextDocument | null;
	// Source attribution for the open text, or null when none applies.
	sourceNotice: SourceNotice | null;
	// The reader's current explicit passage selection, or null when none is active.
	selection: TextSelection | null;
	// The reading-focus passage used as a selection fallback, or null when none is set.
	focus: TextSelection | null;
}

// Sole renderer-side owner of the Library catalogue and the active text's reading state.
export class LibraryStore
{
	// All texts available in the Library catalogue.
	private texts: LibraryTextSummary[] = [];
	// The text currently open for reading, or null when none is open.
	private text: TextDocument | null = null;
	// Source attribution for the open text, or null when none applies.
	private sourceNotice: SourceNotice | null = null;
	// The reader's current explicit passage selection, or null when none is active.
	private selection: TextSelection | null = null;
	// The reading-focus passage used as a selection fallback, or null when none is set.
	private focus: TextSelection | null = null;

	// Returns an immutable snapshot of the full Library state.
	public GetSnapshot(): LibrarySnapshot
	{
		const snapshot: LibrarySnapshot = {
			texts: structuredClone(this.texts),
			text: this.text,
			sourceNotice: structuredClone(this.sourceNotice),
			selection: structuredClone(this.selection),
			focus: structuredClone(this.focus)
		};

		return snapshot;
	}

	// Replaces the Library catalogue with a freshly loaded summary list.
	public SetLibrary(texts: LibraryTextSummary[]): void
	{
		this.texts = structuredClone(texts);
	}

	// Opens a text for reading and clears any selection or reading focus from the previous text.
	public Open(text: TextDocument, sourceNotice: SourceNotice | null): void
	{
		this.text = TextDocument.FromSnapshot(text);
		this.sourceNotice = structuredClone(sourceNotice);
		this.selection = null;
		this.focus = null;
	}

	// Records the reader's current explicit passage selection.
	public SetSelection(selection: TextSelection | null): void
	{
		this.selection = structuredClone(selection);
	}

	// Records the reading-focus passage used as a selection fallback.
	public SetFocus(focus: TextSelection | null): void
	{
		this.focus = structuredClone(focus);
	}

	// Returns the text currently open for reading, or null when none is open.
	public GetText(): TextDocument | null
	{
		return this.text;
	}

	// Returns the source attribution for the open text, or null when none applies.
	public GetSourceNotice(): SourceNotice | null
	{
		return structuredClone(this.sourceNotice);
	}

	// Returns the reader's current explicit passage selection, or null when none is active.
	public GetSelection(): TextSelection | null
	{
		return structuredClone(this.selection);
	}

	// Returns the reader's explicit selection, falling back to the reading focus when none is active.
	public GetContextSelection(): TextSelection | null
	{
		return structuredClone(this.selection ?? this.focus);
	}
}
